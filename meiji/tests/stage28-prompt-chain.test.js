import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFixture, snapshotFixture, taskFixture } from './fixtures/project.js';
import { emptyStoryboardBeatModel } from '../shared/models/storyboard_beat_model.js';
import { assertPromptDialogue } from '../shared/dialogue-integrity.js';
import { assertProgramReview, assertOverride } from '../shared/node-state.js';
import { createId } from '../shared/task_contract.js';
import { commitContent } from '../server/handlers/content.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { composeNodePrompt, createAiRoutes, nodeRoutes } from '../server/http/ai-routes.js';
import { shotsBudget } from '../server/prompts/duration-policy.js';

const line = (speaker_name, mode, dialogue_text, speaker_id = '') => ({ speaker_id, speaker_name, mode, dialogue_text });

test('同人画内转画外不切断一句，完整句可跨拍合并', () => {
  const node = { storyboard: [{ dialogue: [line('甲', '画内', '我还有')] }, { dialogue: [line('甲', '画外', '话说。')] }] };
  assert.throws(() => assertPromptDialogue(node, '(S1)<d>我还有</d>声音转画外。<d>话说。</d>'), error => error.validationKind === 'dialogue-preservation');
  assert.doesNotThrow(() => assertPromptDialogue(node, '声音由画内转画外，(S1)<d>我还有话说。</d>'));
});

test('一个标签不得跨人物，分别完整标记允许被打断的本镜原话', () => {
  for (const ids of [false, true]) {
    const node = { storyboard: [{ dialogue: [line('甲', '画内', '可是我', ids ? 'a' : ''), line('乙', '画内', '别说了！', ids ? 'b' : '')] }] };
    assert.throws(() => assertPromptDialogue(node, '<d>可是我别说了！</d>'), /不同说话人/);
    assert.doesNotThrow(() => assertPromptDialogue(node, '(S1)<d>可是我</d>(S2)<d>别说了！</d>'));
  }
});

test('人工放行也拦截画内外切换导致的一句碎片', () => {
  const p = projectFixture(), shot = p.episodes[0].shot_list.shots[0];
  shot.seconds_storyboard.storyboard = ['0–2s','2–5s'].map((time_range, index) => ({ ...emptyStoryboardBeatModel(), time_range, action: '同一句持续说完', dialogue: [line('甲', index ? '画外' : '画内', index ? '话说。' : '我还有')] }));
  shot.text_to_video_prompt.integrated_multimodal_description = '<d>我还有</d>转画外。<d>话说。</d>';
  assert.throws(() => assertOverride(p, 'storyboard', shot.id), /拆开了一句/);
  shot.text_to_video_prompt.integrated_multimodal_description = '<d>我还有话说。</d>';
  assert.doesNotThrow(() => assertOverride(p, 'storyboard', shot.id));
});

test('心声与实际发声保留各自通道，不因同一人物而误合并', () => {
  const node = { storyboard: [{ dialogue: [line('甲', '心声', '怎么会'), line('甲', '画外', '别走！')] }] };
  assert.doesNotThrow(() => assertPromptDialogue(node, '甲心声<d>怎么会</d>，随后出声<d>别走！</d>'));
  assert.throws(() => assertPromptDialogue(node, '<d>怎么会别走！</d>'), /心声\/实际发声通道/);
});

test('审核分类来源限定为本节点输入，位置与原文依据统一写在原因里', () => {
  const seconds = composeNodePrompt('seconds', 'review', nodeInput('seconds', 'review'), 'codex-gpt');
  const text = composeNodePrompt('storyboard', 'review', nodeInput('storyboard', 'review'), 'codex-gpt');
  assert.match(seconds.system, /上游资料来源只能为本次输入的镜头表、前镜交接、角色资料/);
  assert.match(text.system, /上游资料来源只能为本次输入的节拍分镜、镜头表、角色资料/);
  for (const prompt of [seconds, text]) {
    assert.match(prompt.system, /原因须指明来源、位置并引用该来源中真实的连续原文/);
    assert.deepEqual(prompt.output.structure, { 是否通过: true, 类型: '', 原因: '' });
    assert.equal(prompt.output.optionalStructure, undefined);
  }
});

function nodeInput(node, action) {
  const p = projectFixture(), ep = p.episodes[0], shot = ep.shot_list.shots[0];
  if (node === 'scene-image') return {language:'zh-CN',requirements:'',scene:{name:'客厅'},aspectRatio:'9:16',references:[],...(action === 'regenerate' ? {opinion:'保留布局'} : {})};
  if (node === 'costume-image') return { language: 'zh-CN', requirements: '', person: '人物甲', costume: '蓝衣', referenceDescription: '', aspectRatio: '9:16', references: [], ...(action === 'regenerate' ? { opinion: '保持身份' } : {}) };
  if (node === 'video') return { type: '文生', textPrompt: { integrated_multimodal_description: '人物静立', overall_soundscape: '风声', non_diegetic_music: 'N/A' }, duration: 5, aspectRatio: '9:16', ...(action === 'regenerate' ? { opinion: '保持动作' } : {}) };
  const target = ['project-summary','project-characters','script-review','script-split'].includes(node) ? p.id : ['outline','shots','episode-summary','episode-scenes'].includes(node) ? ep.id : shot.id;
  return taskNodeInput({ project: p, tasks: [], steps: [] }, { id: 'audit', business_type: node, target_id: target, opinion: '保持原话与动作' }, null, action);
}

test('全部12节点33动作可渲染，每份审核完整公共规则只出现一次', () => {
  let actions = 0, reviews = 0;
  for (const [node, route] of Object.entries(nodeRoutes)) for (const action of Object.keys(route.actions)) {
    const prompt = composeNodePrompt(node, action, nodeInput(node, action), 'codex-gpt');
    actions++;
    if (action === 'review') { reviews++; assert.equal((prompt.system.match(/审核只返回是否通过、类型、原因三个字段/g) || []).length, 1, node); }
    assert.doesNotMatch(prompt.body, /\{\{[^{}]+\}\}/, `${node}/${action}`);
  }
  assert.equal(actions, 33); assert.equal(reviews, 9);
});

test('生成修订审核共用节拍、对白字段和摄影边界，不要求额外表演字段', () => {
  for (const action of ['generate','regenerate','review']) {
    const { system } = composeNodePrompt('seconds', action, nodeInput('seconds', action), 'codex-gpt');
    assert.match(system, /普通短动作.*亚秒/); assert.match(system, /持续状态.*跨多秒/);
    assert.doesNotMatch(system, /每个节拍固定1秒|每个节拍为1秒|一般为1–4秒|仅钩子|只有钩子|自主摄影|由本阶段设计|写对白表演/);
    assert.match(system, /dialogue_text只保存实际可听见的原话/);
    assert.match(system, /不新增表演、performance/);
    assert.match(system, /不重新选择整镜背景/);
  }
});

test('普通亚秒节拍及跨多秒持续节拍通过程序审核，时间线仍需精确覆盖', () => {
  const p = projectFixture(), shot = p.episodes[0].shot_list.shots[0];
  shot.hook = '温情';
  shot.seconds_storyboard.storyboard = ['0–0.2s','0.2–5s'].map(time_range => ({ ...emptyStoryboardBeatModel(), time_range, action: '主要动作或持续状态' }));
  assert.doesNotThrow(() => assertProgramReview(p, 'seconds', shot.id));
  shot.seconds_storyboard.storyboard[1].time_range = '0.2–4.9s';
  assert.throws(() => assertProgramReview(p, 'seconds', shot.id), /需等于本镜参考/);
});

test('大纲重复保存和人工放行不抬高固定参考，无法滚动增加30秒', () => {
  const s = snapshotFixture(), ep = s.project.episodes[0]; ep.duration_seconds = 180;
  const content = { segments: [{ sequence: 1, duration_seconds: 210, body: '完整原剧情', causal: '' }] };
  for (const action of ['regenerate','manual_edit','override']) {
    ep.story_outline.segments = structuredClone(content.segments);
    assert.doesNotThrow(() => assertProgramReview(s.project, 'outline', ep.id));
    commitContent(s, taskFixture(s.project, 'outline', ep.id, { action }), content);
    assert.equal(ep.duration_seconds, 180);
    const next = taskNodeInput(s, taskFixture(s.project, 'outline', ep.id), null, 'generate');
    assert.equal(next.duration, 180);
  }
  ep.story_outline.segments[0].duration_seconds = 240;
  assert.throws(() => assertOverride(s.project, 'outline', ep.id), /超出允许范围/);
});

test('镜头表容差与固定集预算取交集，180→210→240不再合法', () => {
  const p = projectFixture(), ep = p.episodes[0], template = ep.shot_list.shots[0];
  ep.duration_seconds = 180; ep.story_outline.segments[0].duration_seconds = 210;
  const budget = shotsBudget(ep.story_outline.segments, ep.duration_seconds);
  assert.equal(budget.target_seconds, 210); assert.equal(budget.min_seconds, 180); assert.equal(budget.max_seconds, 210);
  ep.shot_list.shots = Array.from({ length: 16 }, (_,i) => ({ ...structuredClone(template), id: createId('shot'), sequence: i + 1, number: `S${i + 1}`, duration_seconds: 15 }));
  assert.throws(() => assertProgramReview(p, 'shots', ep.id), /固定集预算/);
  ep.shot_list.shots.splice(14);
  assert.doesNotThrow(() => assertProgramReview(p, 'shots', ep.id));
});

test('上游大纲预算已不合法时，在配置和模型请求前停止镜头任务', async () => {
  let reads = 0;
  const ai = createAiRoutes({ readConfig: async () => { reads++; throw Error('不应读取配置'); } });
  const input = nodeInput('shots', 'generate');
  input.duration = 180;
  input.segments[0].duration_seconds = 240;
  await assert.rejects(ai('shots', 'generate', input), /上游分集改编.*先修正大纲/);
  assert.equal(reads, 0);
});
