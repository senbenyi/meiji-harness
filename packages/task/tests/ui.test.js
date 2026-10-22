import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TaskManager } from '../index.js';
import { createTaskHistory } from '../ui/index.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const findButton = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);
async function fixture() {
  const manager = new TaskManager({ nodes: { custom: { label: '业务提供的节点', plan: () => [{ name: '模型步骤', kind: 'generate', executor: 'ai' }], execute: async ctx => {
    ctx.recordPrompt({ model: 'test-model', messages: [{ role: 'developer', content: '规则原文' }, { role: 'user', content: '<img src=x onerror="alert(1)">\n{{literal}}' }] });
    const transfer = { method: 'POST', path: '/model', request: { body: 'request-body' } };
    ctx.recordHttp(transfer); transfer.body = 'response-body'; transfer.status = 200; ctx.recordHttp(transfer);
    ctx.recordHttp({ method: 'GET', path: '/pending', request: { method: 'GET' } });
    return { result: '结果原文' };
  } } } });
  const row = manager.submit('scope', { group: { name: '示例任务组', metadata: { episode_id: 'business-episode' } }, tasks: [{ node_type: 'custom', name: '任务名称' }] });
  await manager.idle('scope');
  return { manager, row };
}

test('公共历史只有节点类型/状态筛选，全路径可查看任务、步骤、提示词、HTTP并复制实际原文', async t => {
  const { manager, row } = await fixture();
  const dom = new JSDOM('<main></main>');
  const copies = [];
  const source = manager.historySource('scope'); let requests = 0;
  const detail = source.detail; source.detail = id => { requests++; return detail(id); };
  const ui = createTaskHistory({ document: dom.window.document, source, nodeTypes: manager.nodeTypes(), copyText: async text => { copies.push(text); } });
  dom.window.document.querySelector('main').append(ui.element);
  t.after(async () => { ui.dispose(); dom.window.close(); await manager.dispose(); });
  await ui.ready;
  const root = ui.element.shadowRoot;
  assert.deepEqual([...root.querySelectorAll('select')].map(node => node.getAttribute('aria-label')), ['节点类型', '任务状态']);
  assert.match(root.textContent, /业务提供的节点/);
  assert.doesNotMatch(root.textContent, /按选集筛选|全部剧集/);
  findButton(root, '任务名称').click(); await settle();
  assert.match(root.textContent, new RegExp(row.tasks[0].id));
  assert.equal(findButton(root, '查看步骤'), undefined);
  findButton(root, '展开').click(); await settle();
  assert.match(root.textContent, /结果原文/);
  findButton(root, '查看提示词').click(); await settle();
  assert.match(root.textContent, /1\. developer/);
  assert.match(root.textContent, /2\. user/);
  assert.equal(root.querySelector('img'), null);
  root.querySelector('[aria-label="复制全部提示词"]').click(); await settle();
  assert.match(copies[0], /1\. developer:\n规则原文/);
  assert.match(copies[0], /\{\{literal\}\}/);
  findButton(root, '←').click(); await settle();
  findButton(root, '查看 HTTP').click(); await settle();
  assert.match(root.textContent, /request-body/);
  findButton(root, '返回').click(); await settle();
  assert.match(root.textContent, /response-body/);
  root.querySelector('[aria-label="选择请求次数"]').querySelectorAll('button')[1].click(); await settle();
  assert.match(root.textContent, /尚未返回/);
  assert.equal(requests, 1, '详情内切换无需重复请求整组记录');
});

test('筛选、分页由公共数据源处理，失败重试保留当前查询条件', async t => {
  const dom = new JSDOM(); const filters = []; let fail = false;
  const source = { history: async filter => {
    filters.push(filter);
    if (fail) { fail = false; throw Error('暂时不可用'); }
    return { tasks: [], total: 45, offset: filter.offset, limit: filter.limit };
  }, detail: () => null };
  const ui = createTaskHistory({ document: dom.window.document, source, nodeTypes: [{ type: 'custom', label: '自定义' }], pageSize: 20 });
  t.after(() => { ui.dispose(); dom.window.close(); }); await ui.ready;
  const root = ui.element.shadowRoot;
  findButton(root, '下一页').click(); await settle(); assert.equal(filters.at(-1).offset, 20);
  const select = root.querySelector('[aria-label="节点类型"]'); select.value = 'custom'; select.dispatchEvent(new dom.window.Event('change')); await settle();
  assert.deepEqual(filters.at(-1), { unit: 'task', status: '', node_type: 'custom', offset: 0, limit: 20 });
  const count = filters.length;
  assert.equal(root.querySelector('.task-history-header').lastElementChild.textContent, '刷新');
  findButton(root, '刷新').click(); await settle();
  assert.equal(filters.length, count + 1);
  assert.equal(filters.at(-1).node_type, 'custom');
  fail = true; await ui.refresh(); assert.match(root.textContent, /暂时不可用/);
  findButton(root, '重新加载').click(); await settle(); assert.equal(filters.at(-1).node_type, 'custom');
});

test('刷新拒绝晚到响应，dispose 取消订阅且拒绝后续异步绘制', async t => {
  const dom = new JSDOM(); let resolveOld; let calls = 0, unsubscribed = false;
  const ui = createTaskHistory({ document: dom.window.document, source: {
    history: () => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : { tasks: [], total: 2, offset: 0, limit: 20 },
    detail: () => null,
    subscribe: () => () => { unsubscribed = true; },
  } });
  t.after(() => dom.window.close());
  await ui.refresh();
  resolveOld({ tasks: [], total: 99, offset: 0, limit: 20 }); await ui.ready;
  assert.match(ui.element.shadowRoot.textContent, /2 个任务/);
  assert.doesNotMatch(ui.element.shadowRoot.textContent, /99 个任务/);
  ui.dispose(); await ui.refresh(); assert.equal(calls, 2); assert.equal(unsubscribed, true);
});

test('剪贴板失败可重试，多实例不共享筛选与导航状态', async t => {
  const { manager } = await fixture(); const dom = new JSDOM(); let fail = true;
  const ui = createTaskHistory({ document: dom.window.document, source: manager.historySource('scope'), copyText: async () => { if (fail) throw Error('denied'); } });
  const other = createTaskHistory({ document: dom.window.document, source: manager.historySource('scope') });
  t.after(async () => { ui.dispose(); other.dispose(); dom.window.close(); await manager.dispose(); });
  await Promise.all([ui.ready, other.ready]);
  const root = ui.element.shadowRoot, copy = root.querySelector('[aria-label="复制任务 ID"]');
  copy.click(); await settle(); assert.equal(copy.textContent, '复制失败，重试');
  fail = false; copy.click(); await settle(); assert.equal(copy.textContent, '已复制');
  findButton(root, '任务名称').click(); await settle();
  assert.ok(other.element.shadowRoot.querySelector('[aria-label="节点类型"]'));
});
