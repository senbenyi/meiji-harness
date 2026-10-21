import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { HttpRecords } from '../src/records.js';
import { createModelRecorder } from '../src/model-records.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:'), records = new HttpRecords(db), recorder = createModelRecorder({ record: records.record });
  t.after(async () => { await recorder.dispose(); db.close(); });
  return { records, recorder };
}
const options = (extra = {}) => ({ provider: 'provider', model: 'model', sessionId: 'session-one', messages: [{ role: 'user', content: [{ type: 'text', text: '创建项目' }] }], tools: [{ name: 'create', parameters: { type: 'object' } }], ...extra });
async function collect(stream) { const rows = []; for await (const chunk of stream) rows.push(chunk); return rows; }
async function* text(value) { yield { type: 'text-delta', index: 0, text: value }; yield { type: 'finish', reason: { kind: 'stop' } }; }

test('模型调用发出前完整入库：系统、messages、工具、参数及返回原文，输入和流不变', async t => {
  const { records, recorder } = fixture(t);
  const request = Object.freeze(options({ system: '系统规则'.repeat(20000), maxTokens: 300, temperature: 0.5, apiKey: 'must-not-log', signal: new AbortController().signal }));
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '创建' }, { type: 'text-delta', index: 0, text: '成功' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '创建成功' } },
    { type: 'tool-call-delta', index: 1, id: 'tool-one', name: 'create', argumentsDelta: '{"name":' },
    { type: 'tool-call-delta', index: 1, id: 'tool-one', argumentsDelta: '"项目"}' },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 8 } }, { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
  const result = await collect(recorder.stream(request, async function* () {
    const row = records.list()[0]; assert.equal(row.returned_at, null); assert.equal(records.read(row.id).params.system.length, request.system.length);
    yield* chunks;
  }));
  assert.deepEqual(result, chunks); assert.equal(result[0], chunks[0]);
  const row = records.read(records.list()[0].id);
  assert.equal(row.title, '创建项目'); assert.equal(row.method, 'MODEL'); assert.equal(row.status, null); assert.equal(row.ok, true);
  assert.deepEqual(row.params.messages, request.messages); assert.deepEqual(row.params.tools, request.tools);
  assert.equal(row.params.temperature, 0.5); assert.equal(row.params.maxTokens, 300); assert.equal(Object.hasOwn(row.params, 'signal'), false);
  assert.equal(JSON.stringify(row).includes('must-not-log'), false);
  assert.equal(row.response.content[0].text, '创建成功'); assert.equal(row.response.content[1].arguments, '{"name":"项目"}');
  assert.deepEqual(row.response.usage, { inputTokens: 100, outputTokens: 8 }); assert.equal(row.response.chunks.length, chunks.length);
});

test('主会话、标题、子会话并发和再次调用各自记录，不混合', async t => {
  const { records, recorder } = fixture(t);
  const first = options();
  await Promise.all([collect(recorder.stream(first, () => text('主会话'))), collect(recorder.stream(options({ purpose: 'session-title' }), () => text('标题'))), collect(recorder.stream(options({ sessionId: 'child' }), () => text('子会话')))]);
  await collect(recorder.stream(first, () => text('再次调用')));
  const rows = records.list().map(row => records.read(row.id)); assert.equal(rows.length, 4); assert.equal(new Set(rows.map(r => r.id)).size, 4);
  assert.deepEqual(new Set(rows.map(r => r.response.content[0].text)), new Set(['主会话', '标题', '子会话', '再次调用']));
  assert.equal(rows.find(r => r.response.content[0].text === '标题').params.purpose, 'session-title');
  assert.equal(rows.find(r => r.response.content[0].text === '子会话').params.sessionId, 'child');
});

test('模型失败终态保留部分返回和真实错误，不伪造成功状态', async t => {
  const { records, recorder } = fixture(t);
  const result = await collect(recorder.stream(options(), async function* () {
    yield { type: 'text-delta', index: 0, text: '部分返回' }; yield { type: 'finish', reason: { kind: 'error', failure: { message: '上游限流', code: 'RATE_LIMIT', status: 429 } } };
  }));
  assert.equal(result.length, 2); const row = records.read(records.list()[0].id);
  assert.equal(row.ok, false); assert.equal(row.error, '上游限流'); assert.equal(row.status, null); assert.equal(row.response.content[0].text, '部分返回');
  assert.equal(row.response.finish_reason.failure.status, 429);
});

test('取消、异常和消费者退出都保存部分数据，原异常透传', async t => {
  const { records, recorder } = fixture(t); const controller = new AbortController(); const failure = new Error('取消测试');
  await assert.rejects(collect(recorder.stream(options({ signal: controller.signal }), async function* () {
    yield { type: 'text-delta', index: 0, text: '取消前内容' }; controller.abort(); throw failure;
  })), error => error === failure);
  for await (const chunk of recorder.stream(options(), async function* () { yield { type: 'text-delta', index: 0, text: '退出前内容' }; yield { type: 'finish', reason: { kind: 'stop' } }; })) { assert.ok(chunk); break; }
  const rows = records.list().map(r => records.read(r.id)); assert.equal(rows.length, 2); assert.ok(rows.every(r => !r.ok && r.returned_at));
  assert.equal(rows.find(r => r.error === '取消测试').response.finish_reason.kind, 'aborted');
  assert.equal(rows.find(r => r.response.content[0].text === '退出前内容').response.finish_reason.kind, 'interrupted');
});

test('关闭记录器先保存进行中的部分返回，数据库关闭后晚到增量不再写库', async () => {
  const db = new DatabaseSync(':memory:'), records = new HttpRecords(db), recorder = createModelRecorder({ record: records.record });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const iterator = recorder.stream(options(), async function* () { yield { type: 'text-delta', index: 0, text: '关闭前' }; await gate; yield { type: 'text-delta', index: 0, text: '关闭后' }; yield { type: 'finish', reason: { kind: 'stop' } }; })[Symbol.asyncIterator]();
  await iterator.next(); await recorder.dispose();
  const row = records.read(records.list()[0].id); assert.equal(row.response.content[0].text, '关闭前'); assert.equal(row.ok, false); assert.match(row.error, /记录器关闭/);
  db.close(); release(); assert.equal((await iterator.next()).value.text, '关闭后'); await iterator.next(); assert.equal((await iterator.next()).done, true);
  assert.deepEqual(await collect(recorder.stream(options(), () => text('销毁后透传'))), [{ type: 'text-delta', index: 0, text: '销毁后透传' }, { type: 'finish', reason: { kind: 'stop' } }]);
});

test('请求保存失败时不发送模型请求', async () => {
  let called = false; const recorder = createModelRecorder({ record: async () => { throw Error('磁盘失败'); } });
  await assert.rejects(collect(recorder.stream(options(), () => { called = true; return text('不应调用'); })), /磁盘失败/);
  assert.equal(called, false); await recorder.dispose();
});


test('模型标题按用途写入且允许调用方覆盖', async t => {
  const { records, recorder } = fixture(t);
  await collect(recorder.stream(options({ purpose: 'compaction' }), () => text('压缩结果')));
  await collect(recorder.stream(options({ purpose: 'session-title', title: '项目命名' }), () => text('标题')));
  assert.deepEqual(new Set(records.list().map(row => row.title)), new Set(['会话上下文压缩', '项目命名']));
});


test('发送时保存本次输入标题，成功工具参数补充名称，普通回复不覆盖', async t => {
  const { records, recorder } = fixture(t);
  await collect(recorder.stream(options(), async function* () {
    const row = records.list()[0];
    assert.equal(row.title, '创建项目');
    yield { type: 'tool-call-delta', index: 0, name: 'create', argumentsDelta: '{"name":"三英战吕布"}' };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }));
  assert.equal(records.list()[0].title, '创建项目：三英战吕布');
  await collect(recorder.stream(options({ messages: [{ role: 'user', content: '请优化剧本节奏。不要加戏' }] }), () => text('好的，已完成')));
  assert.ok(records.list().some(row => row.title === '优化剧本节奏'));
});

test('失败或部分工具返回保留输入标题，并发/显式/内部用途标题隔离', async t => {
  const { records, recorder } = fixture(t);
  await Promise.all([
    collect(recorder.stream(options(), async function* () {
      yield { type: 'tool-call-delta', index: 0, name: 'create', argumentsDelta: '{"name":"失败项目"}' };
      yield { type: 'finish', reason: { kind: 'error', failure: { message: '失败' } } };
    })),
    collect(recorder.stream(options({ title: '人工标题' }), () => text('{"name":"不覆盖"}'))),
    collect(recorder.stream(options({ purpose: 'session-title' }), () => text('{"name":"不覆盖内部用途"}'))),
  ]);
  assert.deepEqual(new Set(records.list().map(row => row.title)), new Set(['创建项目', '人工标题', '会话标题生成']));
});
