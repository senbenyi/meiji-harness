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
      s.runtime.queue_stopped = true;
      s.tasks = [
        { id: 'old', business_type: 'script-split', target_id: s.project.id, task_status: 'failed', end_reason: '旧错误', queue_order: 1 },
        { id: 'new', business_type: 'script-split', target_id: s.project.id, task_status: status, end_reason: status === 'failed' ? '模型没有返回有效JSON' : '', queue_order: 2 },
      ];
      const view = { page: 'overview' }, context = { session_id: 'session-test', view, refresh: async () => {}, paint: () => {}, onError: () => {} };
      renderTaskPanel(root, s, context);
      const actions = root.querySelector('.episode-head + .workflow-generation-row');
      assert.ok(actions);
      assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.textContent), [...(['queued', 'running'].includes(status) ? [] : ['重新拆分剧集']), '查看拆分任务']);
      const feedback = root.querySelector('.split-task-feedback');
      if (status === 'failed') {
        assert.match(feedback.textContent, /模型没有返回有效JSON/);
        assert.doesNotMatch(feedback.textContent, /旧错误/);
      } else {
        assert.equal(feedback, null);
      }
      actions.querySelector('button:last-child').click();
      assert.equal(view.page, 'history');
      assert.equal(view.task_id, 'new');
    } finally {
      globalThis.document = previous;
      dom.window.close();
    }
  });
}
