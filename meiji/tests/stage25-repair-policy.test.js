import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectFixture, snapshotFixture, taskFixture } from './fixtures/project.js';
import { config } from './fixtures/ai.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { composeNodePrompt, validateNodeResult } from '../server/http/ai-routes.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { nodeRules } from '../server/http/node-rules.js';
import { assertShotDialogue, assertPromptDialogue } from '../shared/dialogue-integrity.js';
import { stampDependencyHash, isNodeCurrent } from '../shared/node-dependencies.js';

const seconds = end => ({ end_state: '人物停在门边。', pending_actions: '', pending_dialogue: '', continuing_audio: '',
  storyboard: [{ time_range: `0–${end}s`, action: '开门', camera: '固定', space: '门边', audio: '', handoff: '', dialogue: [] }] });
const rows = p => taskNodeInput({ project: p, steps: [] }, taskFixture(p, 'shots', p.episodes[0].id), null, 'regenerate').content.shots;
async function scenario(business, respond, check, setup = () => {}) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-repair-policy-'));
  let runtime;
  try {
    const p = projectFixture(); setup(p);
    const snap = { project: p, tasks: [], steps: [] };
    stampDependencyHash(snap, 'outline', p.episodes[0].id);
    stampDependencyHash(snap, 'episode-scenes', p.episodes[0].id);
    stampDependencyHash(snap, 'shots', p.episodes[0].id);
    const calls = [];
    runtime = await createAppRuntime({ home, gateway: { chat: async options => {
      calls.push(options); return respond(options, calls, p);
    } } });
    const model = await runtime.repository.create(p), before = structuredClone(model.read().project);
    const target = business === 'shots' ? p.episodes[0].id : p.episodes[0].shot_list.shots[0].id;
    const submitted = await runtime.tasks.command({ type: 'submit', project_id: p.id, target_id: target, business_type: business,
      action: 'revise', opinion: '修正指定问题，其他保持', request_id: crypto.randomUUID() });
    await runtime.tasks.idle(p.id);
    await check({ snapshot: model.read(), before, calls, taskId: submitted.task_id });
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
}

test('审核契约、提示词与规则面板共用问题定位；兼容旧两字段，拒绝伪造上游', () => {
  const snap = snapshotFixture(), task = taskFixture(snap.project, 'seconds');
  const input = taskNodeInput(snap, task, seconds(5), 'review');
  assert.match(composeNodePrompt('seconds', 'review', input, 'codex-gpt').system, /修复定位/);
  assert.match(nodeRules('seconds').review, /修复定位/);
  assert.doesNotThrow(() => validateNodeResult('seconds', 'review', { 是否通过: true, 原因: '' }, input));
  const issue = { 修复范围: '上游', 来源: '镜头表', 位置: '正文', 依据: input.shot.body, 建议: '先明确原文时间关系' };
  const value = { 是否通过: false, 原因: '上游事实冲突', 问题: [issue] };
  assert.doesNotThrow(() => validateNodeResult('seconds', 'review', value, input));
  assert.throws(() => validateNodeResult('seconds', 'review', { ...value, 是否通过: true, 原因: '' }, input), /通过时应为空/);
  assert.throws(() => validateNodeResult('seconds', 'review', { ...value, 问题: [{ ...issue, 来源: '前镜交接' }] }, input), /没有提供/);
  assert.throws(() => validateNodeResult('seconds', 'review', { ...value, 问题: [{ ...issue, 依据: '不存在的上游文字' }] }, input), /真实上游/);
  assert.throws(() => validateNodeResult('seconds', 'review', { ...value, 问题: [{ ...issue, 来源: '外部随意节点' }] }, input), /实际输入来源/);
});

test('上游矛盾停止下游修订，保留正式镜头、hash和完整审核历史', () => scenario('shots', ({ step }, calls, p) =>
  step.kind === 'review' ? { 是否通过: false, 原因: '先封门后登舱，时间关系冲突', 问题: [{ 修复范围: '上游', 来源: '故事大纲',
    位置: '小段1', 依据: '舱门已封闭。乘员随后登舱。', 建议: '先修正大纲的登舱和封门顺序' }] }
    : { shots: rows(p).map((r, i) => ({ ...r, body: i ? r.body : '候选新正文' })) },
  ({ snapshot, before, calls, taskId }) => {
    const t = snapshot.tasks.find(t => t.id === taskId), node = snapshot.project.episodes[0].shot_list;
    assert.equal(t.task_status, 'rejected'); assert.match(t.end_reason, /需先修正上游.*\n故事大纲 · 小段1/s);
    assert.equal(calls.length, 2); assert.equal(snapshot.steps.filter(s => s.kind === 'revise').length, 0);
    assert.deepEqual(node.shots, before.episodes[0].shot_list.shots);
    assert.equal(node.node_state.dependency_hash, before.episodes[0].shot_list.node_state.dependency_hash);
    assert.equal(snapshot.steps.find(s => s.name.includes('AI审核')).result.问题[0].来源, '故事大纲');
  }, p => { p.episodes[0].story_outline.segments[0].body = '舱门已封闭。乘员随后登舱。'; }));

test('同一候选重复同一确定性程序错误提前终止，正式内容保持', () => scenario('seconds', () => seconds(6),
  ({ snapshot, before, calls, taskId }) => {
    assert.equal(calls.length, 2); assert.match(snapshot.tasks.find(t => t.id === taskId).end_reason, /修订无进展/);
    assert.deepEqual(snapshot.project.episodes[0].shot_list.shots[0].seconds_storyboard.storyboard,
      before.episodes[0].shot_list.shots[0].seconds_storyboard.storyboard);
    assert.equal(snapshot.steps.find(s => s.result?.修订进展).result.修订进展.重复程序错误, true);
  }));

test('候选持续变化时允许用完原修订预算，不因同样时长类别误停', () => scenario('seconds', (o, calls) =>
  o.step.kind === 'review' ? { 是否通过: true, 原因: '' } : seconds([6, 7, 5][calls.filter(c => c.step.kind !== 'review').length - 1]),
  ({ snapshot, calls, taskId }) => {
    assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'completed');
    assert.equal(calls.filter(c => c.step.kind !== 'review').length, 3);
  }));

test('候选改写后审核意见仍是上一轮已指出的问题则停止', () => scenario('seconds', ({ step }, calls) => {
  if (step.kind === 'review') {
    const reviews = calls.filter(c => c.step.kind === 'review').length;
    return { 是否通过: false, 原因: reviews === 1
      ? '待审核内容遗漏了原文明示姓名并承担独立剧情作用的角色桑恪凌夫，还需补年龄'
      : '遗漏了原文明示姓名并承担独立剧情作用的角色桑恪凌夫' };
  }
  const row = seconds(5);
  row.storyboard[0].action = `开门${calls.filter(c => c.step.kind !== 'review').length}`;
  return row;
}, ({ snapshot, calls, taskId }) => {
  const task = snapshot.tasks.find(t => t.id === taskId);
  assert.equal(task.task_status, 'rejected');
  assert.match(task.end_reason, /修订无进展/);
  assert.equal(calls.filter(c => c.step.kind === 'review').length, 2);
  assert.equal(snapshot.steps.find(s => s.result?.修订进展?.重复审核意见).result.修订进展.重复审核意见, true);
  assert.equal(snapshot.steps.filter(s => s.kind === 'revise').length, 1);
}));

test('AI对相同候选拒绝只给定向反馈，不按原因同文提前判无解', () => scenario('seconds', ({ step }, calls) => {
  const reviews = calls.filter(c => c.step.kind === 'review').length;
  return step.kind !== 'review' ? seconds(5) : reviews < 3 ? { 是否通过: false, 原因: '需核对开门动作幅度' } : { 是否通过: true, 原因: '' };
}, ({ snapshot, calls, taskId }) => {
  assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'completed');
  assert.equal(calls.filter(c => c.step.kind === 'review').length, 3);
  assert.match(calls.filter(c => c.step.kind === 'revise').at(-1).messages.at(-1).content, /修订无进展/);
}));

test('明确原对白跨节拍逐字核对：标点、漏句、重复、倒序均拒绝；不从叙述猜原话', () => {
  const p = projectFixture(), shot = p.episodes[0].shot_list.shots[0];
  shot.audio_arrangement.dialogue = '甲：“别急……”；乙：“现在走。”';
  const node = seconds(5);
  node.storyboard[0].dialogue = [{ dialogue_text: '别急' }, { dialogue_text: '……' }, { dialogue_text: '现在走。' }];
  assert.doesNotThrow(() => assertShotDialogue(shot, node));
  for (const text of ['别急现在走。', '别急……', '别急……现在走。现在走。', '现在走。别急……']) {
    node.storyboard[0].dialogue = [{ dialogue_text: text }];
    assert.throws(() => assertShotDialogue(shot, node), /对白完整性/);
  }
  shot.audio_arrangement.dialogue = '人物说明情况，原话未明确';
  assert.doesNotThrow(() => assertShotDialogue(shot, node));
  assert.throws(() => assertPromptDialogue({ storyboard: [{ dialogue: [{ dialogue_text: '别急……' }] }] }, '他说别急。'), /对白完整性/);
  assert.doesNotThrow(() => assertPromptDialogue({ storyboard: [{ dialogue: [{ dialogue_text: '别急' }, { dialogue_text: '……' }] }] }, '他说<d>别急……</d>'));
});

test('patch仅更新指定镜头字段，保留其他镜头完整内容、媒体和依赖', () => scenario('shots', ({ step }, calls, p) =>
  step.kind === 'review' ? { 是否通过: true, 原因: '' } : { mode: 'patch', shots: [{ id: p.episodes[0].shot_list.shots[1].id, changes: { body: '第二镜局部修订' } }] },
  ({ snapshot, before, taskId }) => {
    assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'completed');
    const [a, b] = snapshot.project.episodes[0].shot_list.shots;
    assert.deepEqual(a, before.episodes[0].shot_list.shots[0]);
    assert.equal(b.id, before.episodes[0].shot_list.shots[1].id); assert.equal(b.body, '第二镜局部修订');
    assert.equal(a.seconds_storyboard.node_state.dependency_hash, before.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.dependency_hash);
    assert.ok(isNodeCurrent(snapshot, 'seconds', a.id));
    const generated = snapshot.steps.find(s => s.kind === 'generate');
    assert.equal(generated.prompt.patch.mode, 'patch'); assert.equal(generated.result.shots.length, 2);
  }));

test('patch拒绝非法/重复ID、未知字段和改ID；无mode的片段不删除镜头；replace需明确', () => {
  const snap = snapshotFixture(), task = taskFixture(snap.project, 'shots', snap.project.episodes[0].id);
  const input = taskNodeInput(snap, task, null, 'regenerate'), id = input.content.shots[0].id;
  const patch = shots => ({ mode: 'patch', shots });
  assert.equal(validateNodeResult('shots', 'regenerate', patch([{ id, changes: { body: '新正文' } }]), input).shots.length, 2);
  for (const value of [patch([{ id: '', changes: { body: 'x' } }]), patch([{ id: 's_unknown', changes: { body: 'x' } }]),
    patch([{ id, changes: { body: 'x' } }, { id, changes: { body: 'y' } }]), patch([{ id, changes: { id: 'new' } }]),
    patch([{ id, changes: { unknown: '' } }]), patch([{ id, changes: { reference_anchor: { lighting: 'new' } } }])])
    assert.throws(() => validateNodeResult('shots', 'regenerate', value, input), /局部修订/);
  assert.throws(() => validateNodeResult('shots', 'regenerate', { shots: [input.content.shots[0]] }, input), /显式mode=replace/);
  assert.equal(validateNodeResult('shots', 'regenerate', { mode: 'replace', shots: [input.content.shots[0]] }, input).shots.length, 1);
  assert.throws(() => validateNodeResult('shots', 'regenerate', { mode: 'replace', shots: [], unexpected: true }, input), /未定义|字段/);
  assert.deepEqual(input.content.shots, rows(snap.project));
});

test('错误patch保留原始候选历史，下一轮仍拿完整基稿修正ID', () => scenario('shots', (options, calls, p) => {
  if (options.step.kind === 'review') return { 是否通过: true, 原因: '' };
  const count = calls.filter(c => c.step.kind !== 'review').length;
  if (count === 1) return { mode: 'patch', shots: [{ id: 's_missing', changes: { body: '错误ID候选' } }] };
  assert.equal(options.trace.input.content.shots.length, 2);
  assert.equal(options.trace.input.content.shots[0].id, p.episodes[0].shot_list.shots[0].id);
  assert.match(options.messages.at(-1).content, /未知、重复或空镜头ID/);
  return { mode: 'patch', shots: [{ id: p.episodes[0].shot_list.shots[1].id, changes: { body: '已修复ID' } }] };
}, ({ snapshot, before, taskId }) => {
  assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'completed');
  assert.equal(snapshot.steps.find(s => s.kind === 'generate').result.mode, 'patch');
  assert.deepEqual(snapshot.project.episodes[0].shot_list.shots[0], before.episodes[0].shot_list.shots[0]);
  assert.equal(snapshot.project.episodes[0].shot_list.shots[1].body, '已修复ID');
}));

test('最终提示词<d>合并跨拍原话，逐字拒绝改标点、漏句、重复和倒序', () => {
  const node = { storyboard: [{ dialogue: [{ dialogue_text: '先停……' }, { dialogue_text: '再走。' }] }] };
  assert.doesNotThrow(() => assertPromptDialogue(node, '他说<d>先停……再走。</d>'));
  for (const text of ['<d>先停再走。</d>', '<d>先停……</d>', '<d>先停……再走。再走。</d>', '<d>再走。先停……</d>'])
    assert.throws(() => assertPromptDialogue(node, text), /对白完整性/);
});

test('patch在审核期间取消，晚到审核不写入正式镜头', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-patch-cancel-'));
  let runtime, release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  try {
    const p = projectFixture(), old = structuredClone(p.episodes[0].shot_list.shots);
    runtime = await createAppRuntime({ home, gateway: { chat: async ({ step }) => {
      if (step.kind === 'review') { entered(); await gate; return { 是否通过: true, 原因: '' }; }
      return { mode: 'patch', shots: [{ id: old[0].id, changes: { body: '不能写入的候选' } }] };
    } } });
    const model = await runtime.repository.create(p);
    const normalizedOld = structuredClone(model.read().project.episodes[0].shot_list.shots);
    const submitted = await runtime.tasks.command({ type: 'submit', project_id: p.id, target_id: p.episodes[0].id,
      business_type: 'shots', action: 'revise', opinion: '修镜头', request_id: 'patch-cancel-submit' });
    await ready;
    await runtime.tasks.command({ type: 'cancel', project_id: p.id, task_id: submitted.task_id, request_id: 'patch-cancel' });
    release(); await runtime.tasks.idle(p.id);
    assert.equal(model.read().tasks.find(t => t.id === submitted.task_id).task_status, 'cancelled');
    assert.deepEqual(model.read().project.episodes[0].shot_list.shots, normalizedOld);
  } finally { release(); await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
});
