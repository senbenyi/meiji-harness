import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { requestData, sendChat, withRequestTrace, redactJson, publicHeaders, createDispatcher } from '../src/index.js';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('普通 JSON 请求在发送前记录、完成后补响应，密钥与图片均脱敏', async () => {
  const rows = [], key = 'private-example-key';
  const result = await requestData({ url: 'http://example/v1/action', headers: { Authorization: `Bearer ${key}` }, apiKey: key, body: { image: 'data:image/png;base64,YWJj', secret: key } }, {
    record(row) { if (!rows.includes(row)) rows.push(row); },
    fetchImpl: async (url, request) => {
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, undefined);
      assert.equal(request.method, 'POST');
      assert.equal(JSON.parse(request.body).secret, key);
      return json({ answer: '完成', api_key: key });
    },
  });
  assert.equal(result.data.answer, '完成');
  assert.equal(rows[0].status, 200);
  assert.doesNotMatch(JSON.stringify(rows), /private-example-key|YWJj/);
});

test('FormData 不转为 JSON，GET 不添加凭据，二进制返回完整 Buffer', async () => {
  const form = new FormData(); form.set('file', new Blob(['image']), 'ref.png');
  const first = await requestData({ url: 'http://example/edit', body: form, logBody: { file: 'ref.png' } }, {
    fetchImpl: async (_, options) => { assert.equal(options.body, form); assert.equal(options.headers, undefined); return new Response('bytes'); }, responseType: 'bytes',
  });
  assert.equal(first.data.toString(), 'bytes');
  await requestData({ url: 'http://example/info' }, { fetchImpl: async (_, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.headers, undefined); return json({});
  } });
});

test('读取响应期间超时或外部取消会中止，失败留存原错误', async () => {
  const rows = [];
  const operation = requestData({ url: 'http://example/slow' }, {
    timeoutMs: 5, record: row => rows.push(row),
    fetchImpl: async (_, { signal }) => {
      await delay(50, undefined, { signal }); return json({});
    },
  });
  await assert.rejects(operation, /abort/i);
  assert.equal(rows.at(-1).ok, false); assert.match(rows.at(-1).error, /abort/i);
  const controller = new AbortController(); controller.abort(new Error('外部停止'));
  await assert.rejects(requestData({ url: 'http://example/' }, { signal: controller.signal, fetchImpl: () => assert.fail('不得发送') }), /外部停止/);
});

test('文本 503 可重试且每次独立记录，400 和非完整输出不自动重试', async () => {
  const rows = []; let calls = 0;
  const request = { url: 'http://example/chat/completions', headers: {}, body: {} };
  const text = await sendChat(request, { retryDelays: [0], record: row => rows.push(row), fetchImpl: async () => ++calls === 1 ? json({}, 503) : json({ choices: [{ finish_reason: 'stop', message: { content: ' 完整 ' } }] }) });
  assert.equal(text, '完整'); assert.equal(calls, 2); assert.equal(rows.length, 4);
  assert.equal(rows[0], rows[1]); assert.notEqual(rows[0], rows[2]);
  calls = 0;
  await assert.rejects(sendChat(request, { retryDelays: [0], fetchImpl: async () => { calls++; return json({}, 400); } }), /400/);
  assert.equal(calls, 1);
  await assert.rejects(sendChat(request, { fetchImpl: async () => json({ choices: [{ finish_reason: 'length', message: { content: '半截' } }] }) }), { code: 'INCOMPLETE_MODEL_OUTPUT' });
});

test('并发记录上下文互相隔离，可删除不需保留的轮询记录', async () => {
  const a = [], b = [];
  await Promise.all([
    withRequestTrace(row => a.push(row), () => requestData({ url: 'http://example/a' }, { fetchImpl: async () => { await delay(5); return json({ a: 1 }); } })),
    withRequestTrace(row => b.push(row), () => requestData({ url: 'http://example/b' }, { fetchImpl: async () => json({ b: 1 }) })),
  ]);
  assert.ok(a.every(row => row.path === '/a')); assert.ok(b.every(row => row.path === '/b'));
  const events = [];
  await requestData({ url: 'http://example/poll' }, { keepRecord: () => false, record: (row, options) => events.push(options), fetchImpl: async () => json({ status: 'running' }) });
  assert.deepEqual(events, [undefined, { drop: true }]);
});

test('请求 dispatcher 沿用当前全局代理并设置头/体等待时限', () => {
  const original = getGlobalDispatcher(); let captured;
  try {
    setGlobalDispatcher({ dispatch(options) { captured = options; return true; }, close: async () => {}, destroy: async () => {} });
    createDispatcher(1234).dispatch({ origin: 'http://example', path: '/' }, {});
    assert.equal(captured.headersTimeout, 1234); assert.equal(captured.bodyTimeout, 1234);
  } finally { setGlobalDispatcher(original); }
  assert.equal(publicHeaders({ Authorization: 'secret' }).Authorization, '[已隐藏]');
  assert.equal(redactJson(undefined), null);
});
