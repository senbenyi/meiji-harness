import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { nodeRules } from '../server/http/node-rules.js';
import { nodeRoutes } from '../server/http/nodes/index.js';
import { createTaskHttpHandler } from '../server/http/task-routes.js';
import { renderTaskPanel } from '../client/task-panel.js';
import { snapshotFixture } from './fixtures/project.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';

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
    assert.match(nodeRules('video').review, /程序审核/);
    assert.match(nodeRules('outline').generate, /明显不足/);
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
      ['overview', {}, ['script-review', 'project-summary', 'project-characters']],
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
    assert.equal(requests, 11);
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
