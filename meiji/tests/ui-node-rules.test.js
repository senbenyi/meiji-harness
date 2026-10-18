import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel } from "../client/task-panel.js";
import { snapshotFixture } from "./fixtures/project.js";
import { createServer } from "node:http";
import { nodeRules } from "../server/http/node-rules.js";
import { nodeRoutes } from "../server/http/nodes/index.js";
import { createTaskHttpHandler } from "../server/http/task-routes.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";

describe("node-failure", () => {
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
});

describe("node-rules", () => {
  test('规则接口覆盖所有AI路由，鉴权/绑定先行且无写入或AI调用', async () => {
    const runtime = { bindings: { require: async (sid, pid) => {
      if (sid !== 'bound' || pid !== 'project') throw Object.assign(Error('绑定拒绝'), { status: 403 });
    } } };
    const server = createServer(createTaskHttpHandler(runtime, { authorize: req => req.headers['x-auth'] === '1' ? null : 401 }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/meiji/rules`;
      const get = (business, session = 'bound', auth = true) => fetch(base + '?' + new URLSearchParams({ business, session_id: session, project_id: 'project' }), { headers: auth ? { 'x-auth': '1' } : {} });
      assert.equal((await get('outline', 'bound', false)).status, 401);
      assert.equal((await get('outline', 'wrong')).status, 403);
      for (const business of Object.keys(nodeRoutes)) {
        const response = await get(business);
        assert.equal(response.status, 200, business);
        const value = await response.json();
        assert.deepEqual(value, nodeRules(business));
        assert.ok(value.generate.length > 10, business);
        assert.ok(value.review, business);
        const source = nodeRoutes[business].promptModel?.generate?.system?.规则?.基础规则;
        if (source) assert.ok(value.generate.includes(source), business);
      }
      for (const business of ['unknown', '__proto__', 'assembly', 'tail', 'multimodal']) assert.equal((await get(business)).status, 404);
      assert.match(nodeRules('costume-image').review, /没有 AI 审核/);
      assert.doesNotMatch(nodeRules('video').review, /程序审核/);
      assert.match(nodeRules('outline').generate, /允许改写对白/);
      const characters = nodeRules('project-characters');
      assert.match(characters.generate, /只被提及、只被引用方法或言论/);
      assert.match(characters.generate, /按剧情、时代和身份补成能拍定妆照的设定/);
      assert.match(characters.revise, /不要只返回意见点名的人/);
      assert.match(characters.review, /具体姓名/);
      assert.match(characters.review, /无姓名、职业、序号、群体人数不是遗漏/);
      assert.match(characters.review, /修改意见只用来核对上次的问题是否已解决/);
      assert.doesNotMatch(characters.generate, /句末标“背景补”|必须含“背景补”|原样保留/);
      assert.match(characters.revise, /先核对套数/);
      assert.doesNotMatch(characters.revise, /自由补充|只调整修改意见明确涉及的内容/);
      assert.doesNotMatch(characters.review, /句末标“背景补”|必须含“背景补”|原样保留|自由补充/);
      assert.match(characters.review, /合理补全可以通过/);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  test('各AI节点可在运行时进入三栏规则并返回原位置，程序节点无入口', async () => {
    const dom = new JSDOM('<main></main>'), previous = { document: globalThis.document, fetch: globalThis.fetch, navigator: globalThis.navigator };
    globalThis.document = dom.window.document;
    const copies = [];
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copies.push(value); } } } });
    try {
      const snapshot = snapshotFixture(), p = snapshot.project, e = p.episodes[0], shot = e.shot_list.shots[1];
      p.creation_mode = '剧本';
      e.episode_requirements = '本集补充哨兵';
      const person = emptyCharacterModel({ name: '甲' }); p.character_library.characters.push(person);
      snapshot.tasks.push({ business_type: 'outline', target_id: e.id, task_status: 'running', queue_order: 9 });
      const root = document.querySelector('main'), view = {};
      let requests = 0;
      globalThis.fetch = async url => {
        requests++;
        const business = new URL(url, 'http://localhost').searchParams.get('business');
        return { ok: true, json: async () => nodeRules(business) };
      };
      const context = { session_id: 'session-test', view, refresh: async () => {}, onError: assert.fail,
        paint: () => renderTaskPanel(root, snapshot, context) };
      const cases = [
        ['overview', {}, ['project-summary', 'project-characters']],
        ['episode', { episode_id: e.id, shot_id: null, tab: 'script' }, ['outline', 'episode-summary']],
        ['episode', { episode_id: e.id, shot_id: null, tab: 'shots' }, ['shots']],
        ['episode', { episode_id: e.id, shot_id: shot.id, tab: 'film' }, ['seconds', 'storyboard', 'video']],
        ['character', { character_id: person.id, costume_id: '' }, ['costume-image']],
      ];
      for (const [page, fields, businesses] of cases) for (const business of businesses) {
        Object.assign(view, fields, { page }); context.paint();
        const b = [...root.querySelector(`[data-business="${business}"] .node-ui`).querySelectorAll('button')].find(b => b.textContent === '查看规则');
        assert.ok(b, business); assert.equal(b.hasAttribute('aria-disabled'), false);
        const input = b.closest('.node-ui').querySelector('input');
        if (input) { input.value = '意见哨兵'; input.dispatchEvent(new dom.window.Event('input')); }
        b.click(); await settle();
        assert.equal(view.page, 'skill');
        assert.equal(root.querySelector('dialog'), null);
        assert.equal(root.querySelectorAll('[role=tab]').length, 3);
        assert.equal(root.querySelector('[data-rules=generate]').hidden, false);
        assert.deepEqual([...root.querySelectorAll('[role=tab]')].map(tab => tab.textContent), ['生成规则', '修订规则', '审核规则']);
        assert.deepEqual([...root.querySelectorAll('[data-rules] button')].map(button => button.getAttribute('aria-label')), ['复制生成规则', '复制修订规则', '复制审核规则']);
        const generateInput = root.querySelector('[data-rules=generate] textarea');
        const reviseInput = root.querySelector('[data-rules=revise] textarea');
        assert.equal(root.querySelector('[data-rules=review] textarea'), null);
        if (business === 'outline') { assert.equal(generateInput.getAttribute('aria-label'), '本集要求'); assert.equal(generateInput.value, '本集补充哨兵'); }
        else if (['costume-image', 'video'].includes(business)) assert.equal(generateInput, null);
        else { assert.equal(generateInput.getAttribute('aria-label'), '补充需求'); assert.equal(generateInput.value, snapshot.project.creative_direction); }
        if (nodeRules(business).revise) assert.ok(reviseInput);
        if (input) assert.equal(reviseInput.value, '意见哨兵');
        [...root.querySelectorAll('[role=tab]')].find(b => b.textContent === '修订规则').click();
        assert.equal(root.querySelector('[data-rules=revise]').hidden, false);
        [...root.querySelectorAll('[role=tab]')].find(b => b.textContent === '审核规则').click();
        assert.equal(root.querySelector('[data-rules=review]').hidden, false);
        copies.length = 0;
        root.querySelector('[data-rules=generate] [aria-label="复制生成规则"]').click();
        root.querySelector('[data-rules=revise] [aria-label="复制修订规则"]').click();
        root.querySelector('[data-rules=review] [aria-label="复制审核规则"]').click();
        await settle();
        assert.match(copies[0], /^生成规则\n\n/);
        assert.doesNotMatch(copies[0], /修订规则/);
        assert.match(copies[1], /^修订规则\n\n/);
        assert.match(copies[2], /^审核规则\n\n/);
        if (input) assert.doesNotMatch(copies.join('\n'), /意见哨兵/);
        root.querySelector('.skill-page-head button').click();
        assert.equal(view.page, page);
        for (const [key, value] of Object.entries(fields)) assert.equal(view[key], value);
      }
      Object.assign(view, { page: 'episode', episode_id: e.id, shot_id: shot.id }); context.paint();
      assert.ok(root.querySelector('[data-business="first-last-frame"]'));
      assert.equal([...root.querySelector('[data-business="first-last-frame"]').querySelectorAll('button')].some(b => b.textContent === '查看规则'), false);
      Object.assign(view, { page: 'episode', shot_id: null, tab: 'assembly' }); context.paint();
      assert.equal([...root.querySelector('[data-business="assembly"]').querySelectorAll('button')].some(b => b.textContent === '查看规则'), false);
      view.page = 'overview'; context.paint();
      const split = [...root.querySelectorAll('.episode-node-ui button, .node-ui button')].find(b => b.textContent === '查看规则' && !b.closest('[data-business]'));
      assert.ok(split); split.click(); await settle(); assert.equal(view.rule_business, 'script-split');
      assert.equal(requests, 10);
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previous.navigator }); dom.window.close(); }
  });

  test('规则加载失败可重试，空补充明确说明', async () => {
    const dom = new JSDOM('<main></main>'), previous = { document: globalThis.document, fetch: globalThis.fetch };
    globalThis.document = dom.window.document;
    try {
      const snapshot = snapshotFixture(); snapshot.project.creative_direction = '';
      let attempts = 0;
      globalThis.fetch = async () => { if (++attempts === 1) throw Error('网络暂不可用'); return { ok: true, json: async () => nodeRules('project-summary') }; };
      const root = document.querySelector('main'), context = { session_id: 's', view: { page: 'skill', rule_business: 'project-summary' }, paint: () => {}, onError: assert.fail };
      renderTaskPanel(root, snapshot, context); await settle();
      assert.match(root.textContent, /网络暂不可用/);
      [...root.querySelectorAll('button')].find(b => b.textContent === '重新加载').click(); await settle();
      assert.equal(root.querySelector('[data-rules=generate] textarea').value, '');
      assert.match(root.querySelector('[data-rules=review]').textContent, /不另收输入/);
      assert.equal(attempts, 2);
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
  });
});
