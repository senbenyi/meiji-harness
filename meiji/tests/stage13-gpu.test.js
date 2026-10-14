import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createTaskHttpHandler } from '../server/http/task-routes.js';
import { llmServerClient } from '../server/http/llm-server/client.js';
const listen = async (t, server) => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
};
test('GPU 代理使用独立 llm-server 地址与鉴权，不暴露媒体密钥，且要求宿主登录', async t => {
  let calls = 0, fail = false;
  const data = { sampled_at: '2026-10-14T10:00:00Z', gpus: [{ index: 0, name: 'V100', utilization_percent: 29 }] };
  const upstream = await listen(t, createServer((req, res) => {
    calls++; assert.equal(req.url, '/v1/gpu'); assert.equal(req.headers.authorization, 'Bearer ollama');
    res.statusCode = fail ? 503 : 200;
    res.end(JSON.stringify(fail ? { error: { message: 'private SSH connection detail' } } : data));
  }));
  const runtime = { models: { read: async () => ({ textBaseUrl: upstream + '/v1', apiKey: 'media-secret' }) } };
  const base = await listen(t, createServer(createTaskHttpHandler(runtime, { authorize: req => req.headers['x-test-login'] ? null : 401 })));
  assert.equal((await fetch(base + '/api/meiji/gpu')).status, 401); assert.equal(calls, 0);
  const response = await fetch(base + '/api/meiji/gpu', { headers: { 'x-test-login': 'yes' } });
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(await response.json(), data);
  fail = true;
  const failed = await fetch(base + '/api/meiji/gpu', { headers: { 'x-test-login': 'yes' } });
  assert.equal(failed.status, 503);
  const text = await failed.text(); assert.match(text, /GPU 利用率暂不可用/); assert.doesNotMatch(text, /private|media-secret/);
});
test('GPU 代理连接失败返回可展示的 503，不泄漏地址或异常正文', async () => {
  await assert.rejects(llmServerClient.gpu({ baseUrl: 'http://private/v1', fetchImpl: async (_url, { signal }) => {
    assert.ok(signal); throw new Error('secret host');
  } }), e => e.status === 503 && e.message === 'GPU 利用率暂不可用');
});
