import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createShell } from '../client/panel-shell.js';
import { mountGpuStatus } from '../client/gpu-status.js';
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
