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
      assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.textContent), ['queued', 'running'].includes(status) ? ['任务历史', '取消'] : ['重新生成', '任务历史']);
      const notice = card.querySelector('.node-ui .error');
      if (status === 'failed') {
        assert.match(notice.textContent, /模型没有返回有效JSON/);
        assert.doesNotMatch(notice.textContent, /旧错误/);
      } else {
        assert.equal(notice, null);
      }
      [...actions.querySelectorAll('button')].find((button) => button.textContent === '任务历史').click();
      assert.equal(view.page, 'history');
      assert.equal(view.task_id, 'new');
    } finally {
      globalThis.document = previous;
      dom.window.close();
    }
  });
}
