import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTaskPanel } from '../client/task-panel.js';
import { snapshotFixture } from './fixtures/project.js';

for (const hasOutput of [false, true]) {
  test(`镜头表原因下方修复按钮直接${hasOutput ? '修订已有结果' : '重试首次生成'}，不弹框`, async () => {
    const dom = new JSDOM('<main></main>');
    const previous = { document: globalThis.document, fetch: globalThis.fetch };
    globalThis.document = dom.window.document;
    dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
    const commands = [];
    globalThis.fetch = async (_url, options) => {
      commands.push(JSON.parse(options.body).command);
      return { ok: true, json: async () => ({ accepted: true }) };
    };
    try {
      const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
      const failure = '响应.shots[].audio_arrangement：缺少字段';
      if (!hasOutput) episode.shot_list.shots = [];
      episode.shot_list.node_state.status = 'rejected';
      episode.shot_list.node_state.reason = failure;
      const before = structuredClone(episode.shot_list);
      snapshot.tasks = [{ id: 'rejected-shots', business_type: 'shots', target_id: episode.id, queue_order: 1, task_status: 'rejected', end_reason: failure }];
      const root = document.querySelector('main');
      const context = { session_id: 'test', view: { page: 'episode', episode_id: episode.id, tab: 'shots' }, refresh: async () => {}, paint() {}, onError(error) { throw Error(error); } };
      renderTaskPanel(root, snapshot, context);
      const card = root.querySelector('[data-business="shots"]'), ui = card.querySelector('.node-ui');
      assert.equal(ui.querySelector('.node-ui-task-status').textContent, '最新任务：未通过');
      const opinion = ui.querySelector('.node-ui-opinion');
      assert.equal(opinion.nextElementSibling.textContent, `未通过原因：${failure}`);
      assert.equal(ui.querySelector('.node-ui-failure'), null);
      assert.deepEqual(episode.shot_list, before);
      opinion.value = '公共补充意见';
      opinion.dispatchEvent(new dom.window.Event('input'));
      const repair = ui.querySelector('.node-ui-repair-row');
      assert.equal(opinion.nextElementSibling.nextElementSibling, repair);
      assert.equal(repair.querySelector('button').textContent, '修复（再给 2 轮）');
      assert.ok(![...ui.querySelector('.workflow-generation-row').querySelectorAll('button')].some(button => button.textContent === '修复'));
      repair.querySelector('button').click();
      assert.equal(root.querySelector('dialog'), null);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(commands.at(-1).action, hasOutput ? 'revise' : 'generate');
      assert.equal(commands.at(-1).business_type, 'shots');
      assert.equal(commands.at(-1).opinion, `${failure}\n公共补充意见`);

      snapshot.tasks.push({ id: 'new-shots', business_type: 'shots', target_id: episode.id, queue_order: 2, task_status: 'queued' });
      renderTaskPanel(root, snapshot, context);
      const next = root.querySelector('[data-business="shots"]');
      assert.equal(next.querySelector('.node-ui-task-status').textContent, '最新任务：排队中');
      assert.equal(next.querySelector('.node-ui-failure'), null);
      assert.equal(next.querySelector('.node-ui-repair-row'), null);
    } finally {
      globalThis.document = previous.document;
      globalThis.fetch = previous.fetch;
      dom.window.close();
    }
  });
}

for (const hasOutput of [false, true]) test(`网络失败只展示原因，${hasOutput ? '原结果修订' : '再次生成'}不自动携带接口异常`, async () => {
  const dom = new JSDOM('<main></main>'), previous = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  const commands = [];
  globalThis.fetch = async (_url, options) => { commands.push(JSON.parse(options.body).command); return { ok: true, json: async () => ({}) }; };
  try {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0], root = document.querySelector('main');
    const error = 'HTTP 502：连接服务器失败';
    if (!hasOutput) episode.shot_list.shots = [];
    episode.shot_list.node_state.status = hasOutput ? 'generated' : 'empty';
    episode.shot_list.node_state.reason = '';
    snapshot.tasks = [{ business_type: 'shots', target_id: episode.id, queue_order: 1, task_status: 'failed', end_reason: error }];
    renderTaskPanel(root, snapshot, { session_id: 'test', view: { page: 'episode', episode_id: episode.id, tab: 'shots' }, refresh: async () => {}, paint() {}, onError: assert.fail });
    const card = root.querySelector('[data-business="shots"]');
    assert.equal(card.querySelector('.node-ui-opinion').nextElementSibling.textContent, `失败原因：${error}`);
    assert.equal(card.querySelector('.node-ui-repair-row'), null);
    const label = hasOutput ? '原结果修订' : 'AI生成';
    [...card.querySelectorAll('button')].find(b => b.textContent === label).click();
    if (hasOutput) {
      const dialog = root.querySelector('dialog');
      const opinion = dialog.querySelector('[aria-label="修改意见"]');
      assert.equal(opinion.value, '');
      assert.equal(opinion.tagName, 'TEXTAREA');
      assert.equal(dialog.querySelector('button[type="submit"]').textContent, '提交修订');
      opinion.value = '用户修改意见';
      dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(commands.at(-1).action, hasOutput ? 'revise' : 'generate');
    assert.ok(!(commands.at(-1).opinion || '').includes(error));
    assert.equal(commands.at(-1).opinion, hasOutput ? '用户修改意见' : undefined);
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
});

test('视频未通过的修复只提交该镜视频，长原因可展开，取消的定妆照组显示原因', async () => {
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
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0], shot = episode.shot_list.shots[0];
    const reason = '时长超出镜头预算。'.repeat(12);
    shot.video.address = 'shot.mp4';
    shot.video.node_state.status = 'rejected';
    shot.video.node_state.reason = reason;
    const root = document.querySelector('main');
    const context = { session_id: 'test', view: { page: 'episode', episode_id: episode.id, tab: 'film', shot_id: shot.id }, refresh: async () => {}, paint() {}, onError(error) { throw Error(error); } };
    renderTaskPanel(root, snapshot, context);
    const card = root.querySelector('[data-business="video"]');
    const labels = [...card.querySelectorAll('button')].map(button => button.textContent);
    assert.ok(!labels.includes('原结果修订'));
    assert.ok(card.querySelector('.node-ui-reason').classList.contains('is-clamped'));
    card.querySelector('.node-ui-reason-toggle').click();
    assert.equal(card.querySelector('.node-ui-reason-toggle').textContent, '收起');
    card.querySelector('.node-ui-repair-row button').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(commands.at(-1).type, 'submit');
    assert.equal(commands.at(-1).business_type, 'video');
    assert.equal(commands.at(-1).target_id, shot.id);
    assert.equal(commands.at(-1).action, 'regenerate');
    assert.equal(commands.at(-1).opinion, reason);

    snapshot.groups = [{ id: 'cg', group_type: 'workflow', name: '定妆照' }];
    snapshot.tasks = [{ id: 'ct', group_id: 'cg', group_seq: 1, queue_order: 1, business_type: 'costume-image', target_id: 'missing', task_status: 'cancelled', end_reason: '用户取消项目全部任务' }];
    context.view = { page: 'overview' };
    renderTaskPanel(root, snapshot, context);
    const costume = [...root.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === '生成定妆照');
    assert.equal(costume.querySelector('.error').textContent, '用户取消项目全部任务');
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
});
