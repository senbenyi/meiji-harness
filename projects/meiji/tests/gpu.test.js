import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createShell } from "../client/panel-shell.js";
import { mountGpuStatus } from "../client/gpu-status.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { createTaskHttpHandler } from "../server/http/task-routes.js";
import { llmServerClient } from "../server/http/llm-server/client.js";

describe("gpu-status", () => {
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const metrics = value => ({ sampled_at: '2026-10-14T10:00:00Z', gpus: [{ index: 0, name: 'V100', utilization_percent: value }] });

  test('GPU 顶部立即显示，5 秒轮询、失败替换旧值、隐藏/卸载中止与晚到保护', async t => {
    const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
    const saved = { document: globalThis.document, fetch: globalThis.fetch, window: globalThis.window, localStorage: globalThis.localStorage };
    Object.assign(globalThis, { document: dom.window.document, window: dom.window, localStorage: dom.window.localStorage });
    let hidden = false, fail = false, value = 29, count = 0, block = false, release, lastSignal;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/meiji/gpu'); count++; lastSignal = options.signal;
      if (block) await new Promise(resolve => { release = resolve; });
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => metrics(value) };
    };
    t.mock.timers.enable({ apis: ['setInterval'] });
    const shell = createShell(), { root } = shell, dispose = mountGpuStatus(root);
    const label = root.querySelector('.gpu-status');
    try {
      await flush();
      assert.equal(label.parentElement, root.querySelector('.actions'));
      assert.equal(label.nextElementSibling, root.querySelector('.library'));
      assert.equal(label.textContent, 'GPU：29%');
      t.mock.timers.tick(4999); await flush(); assert.equal(count, 1);
      value = 0; t.mock.timers.tick(1); await flush(); assert.equal(label.textContent, 'GPU：0%');
      fail = true; t.mock.timers.tick(5000); await flush(); assert.equal(label.textContent, 'GPU：暂不可用');
      fail = false; block = true; t.mock.timers.tick(5000); await flush();
      const before = count; t.mock.timers.tick(10000); await flush(); assert.equal(count, before);
      hidden = true; document.dispatchEvent(new dom.window.Event('visibilitychange'));
      assert.equal(lastSignal.aborted, true); assert.equal(label.textContent, 'GPU：--');
      release(); await flush(); assert.equal(label.textContent, 'GPU：--');
      t.mock.timers.tick(10000); await flush(); assert.equal(count, before);
      hidden = false; value = 64; block = false;
      document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush();
      assert.equal(label.textContent, 'GPU：64%');
      block = true; t.mock.timers.tick(5000); await flush();
      dispose(); assert.equal(lastSignal.aborted, true);
      release(); await flush(); assert.equal(root.querySelector('.gpu-status'), null);
      const finalCount = count; t.mock.timers.tick(10000); await flush(); assert.equal(count, finalCount);
    } finally { dispose(); shell.dispose(); t.mock.timers.reset(); Object.assign(globalThis, saved); dom.window.close(); }
  });

  test('多 GPU 独立显示，不支持利用率时显示 -- 而不是 0%', async () => {
    const dom = new JSDOM('<nav class="actions"><button class="library">片库</button></nav>', { pretendToBeVisual: true });
    const saved = { document: globalThis.document, fetch: globalThis.fetch, window: globalThis.window, localStorage: globalThis.localStorage };
    Object.assign(globalThis, { document: dom.window.document, fetch: async () => ({ ok: true, json: async () => ({ sampled_at: '2026-10-14T10:00:00Z', gpus: [metrics(12).gpus[0], { index: 1, name: 'GPU B', utilization_percent: null }] }) }) });
    const dispose = mountGpuStatus(document.body);
    try { await flush(); assert.equal(document.querySelector('.gpu-status').textContent, 'GPU 0：12% · GPU 1：--'); }
    finally { dispose(); Object.assign(globalThis, saved); dom.window.close(); }
  });
});

describe("gpu", () => {
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
});
