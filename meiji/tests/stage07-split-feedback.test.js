import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTaskPanel } from '../client/task-panel.js';
import { snapshotFixture } from './fixtures/project.js';

for (const status of ['queued', 'running', 'failed', 'completed', 'cancelled', 'superseded']) {
  test(`拆分任务${status}在标题操作区并列显示操作且进入最新任务`, () => {
    const dom = new JSDOM('<main></main>'), previous = globalThis.document;
    try {
      globalThis.document = dom.window.document;
      const s = snapshotFixture(), root = document.querySelector('main');
      s.project.creation_mode = '剧本';
      s.tasks = [
        { id: 'old', business_type: 'script-split', target_id: s.project.id, task_status: 'failed', end_reason: '旧错误', queue_order: 1 },
        { id: 'new', business_type: 'script-split', target_id: s.project.id, task_status: status, end_reason: status === 'failed' ? '模型没有返回有效JSON' : '', queue_order: 2 },
      ];
      const view = { page: 'overview' }, context = { session_id: 'session-test', view, refresh: async () => {}, paint: () => {}, onError: () => {} };
      renderTaskPanel(root, s, context);
      const card = [...root.querySelectorAll('section')].find((item) => item.querySelector('h3')?.textContent === '剧集');
      const actions = card.querySelector('.node-ui .workflow-generation-row');
      assert.ok(actions);
      assert.equal(card.querySelector('.episode-head'), null);
      assert.deepEqual([...actions.children].map((node) => node.className), ['node-ui-buttons', 'node-ui-task-status']);
      assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.textContent), ['queued', 'running'].includes(status) ? ['任务历史', '取消', '查看规则'] : ['重新生成', '任务历史', '查看规则']);
      const notice = card.querySelector('.node-ui .error');
      if (status === 'failed') {
        assert.equal(card.querySelector('.node-ui-task-status').textContent, '最新任务：失败');
        assert.equal(card.querySelector('.node-ui-opinion').nextElementSibling, notice);
        assert.match(notice.textContent, /模型没有返回有效JSON/);
        assert.doesNotMatch(notice.textContent, /旧错误/);
      } else {
        assert.equal(notice, null);
      }
      [...actions.querySelectorAll('button')].find((button) => button.textContent === '任务历史').click();
      assert.equal(view.page, 'history');
      assert.equal(view.task_id, 'new');
      assert.equal(card.querySelector('.node-ui-repair-row'), null);
    } finally {
      globalThis.document = previous;
      dom.window.close();
    }
  });
}

test('拆分未通过时原因下方修复直接修订候选，不弹框', async () => {
  const dom = new JSDOM('<main></main>');
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  const commands = [];
  globalThis.fetch = async (_url, options) => {
    commands.push(JSON.parse(options.body).command);
    return { ok: true, json: async () => ({ accepted: true }) };
  };
  try {
    const s = snapshotFixture(), root = document.querySelector('main');
    s.project.creation_mode = '剧本';
    s.project.episodes = [];
    const reason = '第1集超过容量上限';
    s.tasks = [{ id: 'split-rejected', business_type: 'script-split', target_id: s.project.id, task_status: 'rejected', end_reason: reason, queue_order: 1 }];
    const view = { page: 'overview' };
    renderTaskPanel(root, s, { session_id: 'session-test', view, refresh: async () => {}, paint: () => {}, onError: (message) => { throw new Error(message); } });
    const card = [...root.querySelectorAll('section')].find((item) => item.querySelector('h3')?.textContent === '剧集');
    const ui = card.querySelector('.node-ui');
    assert.deepEqual([...ui.querySelector('.workflow-generation-row').querySelectorAll('button')].map((button) => button.textContent), ['AI生成', '人工放行', '任务历史', '查看规则']);
    const notice = ui.querySelector('.node-ui-opinion').nextElementSibling;
    assert.equal(notice.textContent, `未通过原因：${reason}`);
    const repair = notice.nextElementSibling;
    assert.equal(repair.className, 'node-ui-buttons node-ui-repair-row');
    assert.equal(repair.querySelector('button').textContent, '修复（再给 2 轮）');
    ui.querySelector('.workflow-generation-row button').nextElementSibling.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(commands.at(-1).type, 'override');
    assert.equal(commands.at(-1).business_type, 'script-split');
    ui.querySelector('.node-ui-opinion').value = '再提前一集';
    ui.querySelector('.node-ui-opinion').dispatchEvent(new dom.window.Event('input'));
    repair.querySelector('button').click();
    assert.equal(root.querySelector('dialog'), null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(commands.at(-1).business_type, 'script-split');
    assert.equal(commands.at(-1).action, 'revise');
    assert.equal(commands.at(-1).target_id, s.project.id);
    assert.equal(commands.at(-1).opinion, `${reason}\n再提前一集`);
  } finally {
    globalThis.document = previous.document;
    globalThis.fetch = previous.fetch;
    dom.window.close();
  }
});
