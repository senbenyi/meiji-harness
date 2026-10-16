import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { snapshotFixture, taskFixture } from './fixtures/project.js';
import { sampleInput, renderTaskPrompt } from './fixtures/ai.js';
import { nodeRoutes } from '../server/http/nodes/index.js';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { shotSceneSetup } from '../shared/shot-text-inputs.js';
import { dependencyHash } from '../shared/node-dependencies.js';
import { renderTaskPanel } from '../client/task-panel.js';

function setup() {
  const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0], shot = episode.shot_list.shots[0];
  Object.assign(shot, {
    body: '场景背景：黑暗火场，门后透出火光。事件：消防员推门。摄影安排：固定机位观察门面，对焦手掌接触位置。',
    shot_scale: '特写', continuity_transition: '从黑暗开场，末尾门已推开。',
    reference_anchor: { fixed_landmark: '门框位于画面右侧，门面占中央。', character_positions: '只有戴手套的手与袖口入镜，手从画面左侧进入。', departed_characters: '', lighting: '门后暖色火光为主光。' },
    on_screen_characters: [], background_characters: "", audio_arrangement: { narration: '', dialogue: '', sound_effects: '近处呼吸器警报与门后火焰声。' },
  });
  return { snapshot, episode, shot };
}

test('镜头表/每秒/提示词生成修订审核统一整镜职责，保持原输出字段', () => {
  for (const business of ['shots', 'seconds', 'storyboard']) for (const action of ['generate', 'regenerate', 'review']) {
    const route = nodeRoutes[business], input = sampleInput(route.actions[action].input);
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      const prompt = composeNodePrompt(business, action, input, model);
      assert.match(prompt.system, /整镜/);
      if (business === 'shots') assert.match(prompt.system, /body 在完整事件之外交代可见场景背景及整镜摄影安排/);
      if (business === 'seconds') assert.match(prompt.system, /本节点直接读取继承/);
      if (business === 'storyboard') assert.match(prompt.system, /shot_setup.*程序从当前镜头表读取/);
      if (action !== 'review' && business === 'seconds') assert.equal(Object.hasOwn(prompt.output.structure, 'shot_setup'), false);
      if (action !== 'review' && business === 'shots') assert.equal(Object.hasOwn(prompt.output.structure.shots[0], 'scene_setup'), false);
    }
  }
});

test('整镜设定传递至每秒与最终三动作，输入和hash同源且不含媒体', () => {
  const { snapshot, shot } = setup(), task = taskFixture(snapshot.project, 'storyboard', shot.id);
  const expected = shotSceneSetup(shot), before = structuredClone(shot.seconds_storyboard);
  const seconds = taskNodeInput(snapshot, { ...task, business_type: 'seconds' }, null, 'generate');
  assert.deepEqual(seconds.shot.reference_anchor, expected.reference_anchor);
  assert.equal(seconds.shot.body, expected.body);
  for (const action of ['generate', 'regenerate', 'review']) {
    const input = taskNodeInput(snapshot, task, shot.text_to_video_prompt, action);
    assert.deepEqual(input.storyboard.shot_setup, expected);
    const prompt = renderTaskPrompt(snapshot, task, shot.text_to_video_prompt, action);
    assert.ok(prompt.messages.some(message => message.content.includes('固定机位观察门面')));
    assert.ok(prompt.messages.some(message => message.content.includes('只有戴手套的手与袖口入镜')));
  }
  const hash = dependencyHash(snapshot, 'storyboard', shot.id);
  shot.video.address = 'new-video.mp4'; shot.last_frame.address = 'new-tail.png';
  assert.equal(dependencyHash(snapshot, 'storyboard', shot.id), hash);
  shot.reference_anchor.lighting = '门后火光减弱。';
  assert.notEqual(dependencyHash(snapshot, 'storyboard', shot.id), hash);
  assert.deepEqual(shot.seconds_storyboard, before);
  expected.reference_anchor.lighting = '修改副本';
  assert.equal(shot.reference_anchor.lighting, '门后火光减弱。');
  assert.doesNotMatch(JSON.stringify(shotSceneSetup(shot)), /\.mp4|\.png|dependency_hash/);
});

test('每秒卡片先展示本镜镜头表设定再展示时间线，刷新读取当前源且不改原结果', () => {
  const dom = new JSDOM('<main></main>'), previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const { snapshot, episode, shot } = setup(), root = document.querySelector('main');
    const saved = structuredClone(shot.seconds_storyboard);
    const context = { session_id: 'test', view: { page: 'episode', episode_id: episode.id, shot_id: shot.id, tab: 'film' }, paint: () => {}, refresh: async () => {}, onError: assert.fail };
    const paint = () => renderTaskPanel(root, snapshot, context);
    paint();
    const card = root.querySelector('[data-business=seconds]');
    const setupCard = card.querySelector('.seconds-shot-setup');
    assert.match(setupCard.textContent, /整镜设定（来自镜头表）/);
    for (const value of ['黑暗火场', '固定机位观察门面', '特写', '门框位于画面右侧', '只有戴手套的手与袖口入镜', '暖色火光', '近处呼吸器警报']) assert.ok(setupCard.textContent.includes(value), value);
    assert.equal(setupCard.nextElementSibling.textContent, '逐秒时间线');
    assert.equal(setupCard.compareDocumentPosition(card.querySelector('.seconds-beats')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(setupCard.querySelector('textarea,input,button'), null);
    shot.reference_anchor.lighting = '更新光位哨兵'; paint();
    assert.match(root.querySelector('.seconds-shot-setup').textContent, /更新光位哨兵/);
    context.view.shot_id = episode.shot_list.shots[1].id; paint();
    assert.doesNotMatch(root.querySelector('.seconds-shot-setup').textContent, /固定机位观察门面|更新光位哨兵/);
    assert.deepEqual(shot.seconds_storyboard, saved);
  } finally { globalThis.document = previous; dom.window.close(); }
});
