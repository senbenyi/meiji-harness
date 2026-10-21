import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHttpHistory, renderHttpDetails } from '../ui/index.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const button = (root, label) => [...root.querySelectorAll('button')].find(node => node.textContent === label);

test('原HTTP详情保留次数、请求/返回、关联提示词、原文复制与等待状态', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('main'), copies = [];
  const dispose = renderHttpDetails(root, { transfers: [
    { id: 'one', prompt_id: 'prompt', method: 'POST', path: '/model', request: { body: '<script>literal</script>' }, status: 200, body: 'result' },
    { id: 'two', method: 'GET', path: '/pending', request: { method: 'GET' } },
  ], copyText: async text => copies.push(text) }); t.after(dispose);
  assert.match(root.textContent, /关联提示词 ID：prompt/); assert.equal(root.querySelector('script'), null);
  button(root, '复制').click(); await tick(); assert.equal(copies[0], 'one');
  button(root, '返回').click(); assert.match(root.querySelector('pre').textContent, /result/);
  [...root.querySelectorAll('[role=tab]')].find(n => n.textContent.startsWith('第 2 次')).click(); assert.match(root.textContent, /尚未返回/);
  button(root, '请求').click(); assert.match(root.querySelector('pre').textContent, /GET/);
});

test('HTTP独立列表分页、按需详情、返回保留页码、刷新失败可重试', async t => {
  const dom = new JSDOM(); t.after(() => dom.window.close()); const calls = [], copies = []; let fail = false;
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i), method: 'POST', path: '/model', started_at: 'now', returned_at: 'later', status: 200 }));
  const ui = createHttpHistory({ document: dom.window.document, pageSize: 1, copyText: async text => copies.push(text), source: {
    list: filter => { calls.push(filter); if (fail) throw Error('临时失败'); return rows.slice(filter.offset, filter.offset + filter.limit); },
    read: id => ({ ...rows[Number(id)], headers: { test: 'header' }, params: { input: 'request' }, response: { answer: 'response' }, ok: true, error: '' }),
  } }); t.after(() => ui.dispose()); await ui.ready;
  const root = ui.element.shadowRoot; assert.equal(root.querySelectorAll('.http-record').length, 1);
  button(root, '下一页').click(); await tick(); root.querySelector('.http-record').click(); await tick();
  assert.match(root.querySelector('pre').textContent, /request/); button(root, '返回').click(); assert.match(root.querySelector('pre').textContent, /response/);
  root.querySelector('[aria-label="复制返回"]').click(); await tick(); assert.match(copies[0], /response/);
  assert.equal(root.querySelector('.history-back').getAttribute('aria-label'), '返回');
  assert.equal(root.querySelector('.history-back').textContent, '←');
  assert.equal(root.querySelector('.history-heading').lastElementChild.className, 'history-refresh');
  button(root, '←').click(); await tick(); assert.equal(calls.at(-1).offset, 1);
  fail = true; button(root, '刷新').click(); await tick(); assert.match(root.textContent, /临时失败/);
  fail = false; button(root, '重新加载').click(); await tick(); assert.equal(root.querySelectorAll('.http-record').length, 1);
});

test('HTTP列表晚到响应、销毁和复制失败保护', async t => {
  const dom = new JSDOM(); t.after(() => dom.window.close()); let resolve;
  const ui = createHttpHistory({ document: dom.window.document, source: { list: () => new Promise(r => { resolve = r; }), read: () => null } });
  ui.dispose(); resolve([]); await ui.ready; assert.equal(ui.element.shadowRoot.textContent.includes('暂无HTTP记录'), false);
  const root = dom.window.document.createElement('div');
  const dispose = renderHttpDetails(root, { transfers: [{ id: 'pending', returned_at: null, method: 'GET', path: '/', params: null }], copyText: async () => { throw Error('denied'); } }); t.after(dispose);
  root.querySelector('[aria-label="复制HTTP ID"]').click(); await tick(); assert.match(root.textContent, /复制失败/);
  button(root, '返回').click(); assert.match(root.textContent, /尚未返回/);
});
