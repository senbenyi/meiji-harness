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

test('历史视频未通过不提供修复，长原因可展开，取消的定妆照组显示原因', async () => {
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
    assert.equal(labels.some(label => /^修复/.test(label)), false);
    assert.equal(commands.length, 0);

    snapshot.groups = [{ id: 'cg', group_type: 'workflow', name: '定妆照' }];
    snapshot.tasks = [{ id: 'ct', group_id: 'cg', group_seq: 1, queue_order: 1, business_type: 'costume-image', target_id: 'missing', task_status: 'cancelled', end_reason: '用户取消项目全部任务' }];
    context.view = { page: 'overview' };
    renderTaskPanel(root, snapshot, context);
    const costume = [...root.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === '生成定妆照');
    assert.equal(costume.querySelector('.error').textContent, '用户取消项目全部任务');
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
});

for (const [nextStatus, label] of [[null,'已取消'],['completed','已通过'],['running','生成中'],['failed','失败']]) {
  test(`成片列表按后续单节点任务更新：${nextStatus || '没有后续任务'}`, () => {
    const dom = new JSDOM('<main></main>'), previous = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      const snapshot = snapshotFixture(), p = snapshot.project, e = p.episodes[0], shot = e.shot_list.shots[0];
      const group = { id:'old-film', group_type:'episode-film', episode_id:e.id, shot_ids:[shot.id] };
      const original = { id:'old-video', group_id:group.id, group_seq:1, business_type:'video', target_id:shot.id, queue_order:1, task_status:'cancelled', end_reason:'用户取消' };
      snapshot.groups = [group]; snapshot.tasks = [original];
      p.latest_groups[`episode-film:${e.id}`] = group.id;
      p.latest_groups[`shot-film:${shot.id}`] = group.id;
      if (nextStatus) {
        snapshot.groups.push({ id:'new-single', group_type:'single' });
        snapshot.tasks.push({ ...original, id:'new-video', group_id:'new-single', queue_order:2, task_status:nextStatus, end_reason:nextStatus==='failed'?'下载失败':'' });
      }
      const before = structuredClone(snapshot);
      const root = document.querySelector('main');
      renderTaskPanel(root,snapshot,{session_id:'test',view:{page:'episode',episode_id:e.id,tab:'film'},refresh:async()=>{},paint(){},onError:assert.fail});
      const overview = [...root.querySelectorAll('.session-project')].find(el=>el.querySelector('h3')?.textContent==='逐镜头成片');
      const card = root.querySelector('.shot-card');
      for (const area of [overview,card]) {
        assert.equal(area.querySelector('.task-group-ui .node-ui-status').textContent,label);
        assert.equal(area.textContent.includes('用户取消'), !nextStatus);
        assert.equal(area.textContent.includes('下载失败'), nextStatus==='failed');
      }
      assert.deepEqual(snapshot,before,'展示不改写历史任务或组');
    } finally { globalThis.document=previous; dom.window.close(); }
  });
}
