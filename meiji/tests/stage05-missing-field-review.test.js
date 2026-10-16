import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRepository } from '../server/data/model-repository.js';
import { TaskService } from '../server/flow/tasks/task-manager.js';
import { createTestTextHandler } from './fixtures/ai.js';
import { createHandlerRegistry } from '../server/handlers/handler-registry.js';
import { commitContent } from '../server/handlers/content.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';
import { projectFixture } from './fixtures/project.js';

async function scenario({ businessError = '', businessRounds = 0, badJson = false, unknownRounds = 0, unknownOnRound = 0, emptyFirst = false, missingRounds = 0, empty = false, network = false, badReview = false, business = 'shots' } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-missing-review-'));
  const project = projectFixture(), episode = project.episodes[0];
  if (businessError) project.character_library.characters = [emptyCharacterModel({ name: '甲' })];
  const fields = ['title', 'id', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];
  const valid = business === 'shots' ? { shots: episode.shot_list.shots.map(shot => Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])]))) }
    : { characters: [{ name: '测试人物', gender: '女', era: '未明确', position: '主角', age_range: '', body_type: '', hairstyle: '', signature_props: [], immutable_traits: [], costumes: [] }] };
  if (empty) episode.shot_list.shots = [];
  let count = 0;
  const calls = [];
  const repository = new ModelRepository(home), model = await repository.create(project);
  const before = structuredClone(model.read().project.episodes[0].shot_list);
  const text = createTestTextHandler({ chat: async options => {
    calls.push({ kind: options.step.kind, messages: structuredClone(options.messages) });
    if (network) throw new Error('网络接口异常：响应.shots[].audio_arrangement：缺少字段');
    if (options.step.kind === 'review') return badReview ? { 是否通过: true } : { 是否通过: true, 原因: '' };
    count++;
    if (badJson) return 'not JSON';
    const candidate = structuredClone(valid);
    if (count <= missingRounds) {
      if (business === 'shots') delete candidate.shots[0].audio_arrangement;
      else delete candidate.characters[0].gender;
    }
    if (business === 'shots' && (count <= unknownRounds || count === unknownOnRound))
      candidate.shots[0].reference_anchor.body = candidate.shots[0].body;
    if (businessError === 'duplicate-shot' && count <= businessRounds) candidate.shots[1].id = candidate.shots[0].id;
    else if (businessError === 'unknown-shot' && count <= businessRounds) candidate.shots[0].id = 's_unknown';
    else if (businessError && count <= businessRounds) {
      const character = project.character_library.characters[0];
      candidate.shots[0].on_screen_characters = businessError === 'unknown'
        ? [{ character_id: 'c_unknown', costume_id: '' }]
        : businessError === 'duplicate'
          ? [0, 1].map(() => ({ character_id: character.id, costume_id: character.costumes[0]?.id || '' }))
          : [{ character_id: character.id, costume_id: 'co_wrong' }];
    }
    if (emptyFirst && count === 1) candidate.shots = [];
    if (options.step.kind === 'revise' && business === 'shots') candidate.mode = 'replace';
    return JSON.stringify(candidate);
  } });
  const service = new TaskService({ repository, execute: createHandlerRegistry({ text }), commitOutput: commitContent });
  try {
    const submitted = await service.command({ type: 'submit', project_id: project.id, request_id: 'missing-field', business_type: business, target_id: business === 'shots' ? episode.id : project.id, action: empty || business === 'project-characters' ? 'generate' : 'regenerate' });
    await service.idle(project.id);
    return { snapshot: model.read(), taskId: submitted.task_id, calls, count, before };
  } finally { await service.dispose(); await repository.close(); await rm(home, { recursive: true, force: true }); }
}

test('镜头表缺字段进入程序审核未通过，携带原始候选和原因修订后成功', async () => {
  const { snapshot, taskId, calls, count } = await scenario({ missingRounds: 1 });
  assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'completed', snapshot.tasks.find(t => t.id === taskId).end_reason);
  assert.equal(count, 2);
  const rejected = snapshot.steps.find(s => s.task_id === taskId && s.step_status === 'rejected');
  assert.match(rejected.name, /程序审核/);
  assert.match(rejected.error_reason, /audio_arrangement.*缺少字段/);
  const revise = calls.find(c => c.kind === 'revise');
  assert.deepEqual(revise.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(Object.hasOwn(JSON.parse(revise.messages[2].content).shots[0], 'audio_arrangement'), false);
  assert.ok(revise.messages[3].content.includes(rejected.error_reason));
});

for (const empty of [false, true]) test(`缺字段重复不变提前结束为未通过，保留${empty ? '空节点' : '旧正文及hash'}`, async () => {
  const { snapshot, taskId, count, before } = await scenario({ missingRounds: Infinity, empty });
  const task = snapshot.tasks.find(t => t.id === taskId), node = snapshot.project.episodes[0].shot_list;
  assert.equal(task.task_status, 'rejected');
  assert.equal(count, 2);
  assert.match(task.end_reason, /修订无进展/);
  assert.equal(node.node_state.status, 'rejected');
  assert.equal(node.node_state.reason, task.end_reason);
  assert.deepEqual(node.shots, before.shots);
  assert.equal(node.node_state.dependency_hash, before.node_state.dependency_hash);
  const steps = snapshot.steps.filter(s => s.task_id === taskId);
  assert.equal(steps.filter(s => s.step_status === 'rejected').length, 2);
  assert.equal(Object.hasOwn(steps.find(s => s.kind === 'generate').result.shots[0], 'audio_arrangement'), false);
  assert.ok(steps.every(s => s.step_status !== 'failed'));
});

test('原无程序审核的角色节点缺字段也执行结构程序审核并修复', async () => {
  const { snapshot, taskId, count } = await scenario({ business: 'project-characters', missingRounds: 1 });
  assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'completed', snapshot.tasks.find(t => t.id === taskId).end_reason);
  assert.equal(count, 2);
  assert.ok(snapshot.steps.some(s => s.task_id === taskId && s.step_status === 'rejected' && /程序审核/.test(s.name)));
});

for (const options of [{ network: true }, { badReview: true }]) test(`${options.network ? '网络接口异常即使包含缺字段文案' : '审核接口缺协议字段'}按异常类型结算且不进入正文修订`, async () => {
  const { snapshot, taskId, calls, before } = await scenario(options);
  assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, options.network ? 'failed' : 'rejected');
  assert.ok(!calls.some(c => c.kind === 'revise'));
  assert.deepEqual(snapshot.project.episodes[0].shot_list.shots, before.shots);
  assert.equal(snapshot.project.episodes[0].shot_list.node_state.dependency_hash, before.node_state.dependency_hash);
});

test('镜头表锚点重复body进入原轮次修订，保留错误候选及字段路径', async () => {
  const {snapshot,taskId,calls,count} = await scenario({unknownRounds:1});
  assert.equal(snapshot.tasks.find(t=>t.id===taskId).task_status,'completed');
  assert.equal(count,2);
  const first=snapshot.steps.find(s=>s.kind==='generate');
  assert.equal(first.result.shots[0].reference_anchor.body, first.result.shots[0].body);
  const revise=calls.find(c=>c.kind==='revise');
  assert.match(revise.messages.at(-1).content,/reference_anchor.body.*未定义字段/);
  assert.equal(Object.hasOwn(snapshot.project.episodes[0].shot_list.shots[0].reference_anchor,'body'),false);
});
test('镜头表嵌套错误重复不变提前结束，不覆盖旧正文及hash', async () => {
  const {snapshot,taskId,count,before} = await scenario({unknownRounds:Infinity});
  const task=snapshot.tasks.find(t=>t.id===taskId),node=snapshot.project.episodes[0].shot_list;
  assert.equal(task.task_status,'rejected'); assert.equal(count,2); assert.match(task.end_reason,/修订无进展/);
  assert.deepEqual(node.shots,before.shots);
  assert.equal(node.node_state.dependency_hash,before.node_state.dependency_hash);
  assert.ok(snapshot.steps.every(s=>s.step_status!=='failed'));
});
test('空镜头表后修订出现锚点错层，共用两次修订并可恢复', async () => {
  const {snapshot,taskId,count} = await scenario({emptyFirst:true,unknownOnRound:2});
  assert.equal(snapshot.tasks.find(t=>t.id===taskId).task_status,'completed');
  assert.equal(count,3);
  assert.equal(snapshot.steps.filter(s=>s.kind==='revise').length,2);
});

for (const businessError of ['unknown', 'duplicate', 'costume', 'duplicate-shot', 'unknown-shot']) {
  for (const businessRounds of [1, Infinity]) test(`业务校验 ${businessError} ${businessRounds === 1 ? '修订成功' : '耗尽后未通过'}`, async () => {
    const { snapshot, taskId, calls, count, before } = await scenario({ businessError, businessRounds });
    const task = snapshot.tasks.find(t => t.id === taskId);
    assert.equal(task.task_status, businessRounds === 1 ? 'completed' : 'rejected', task.end_reason);
    assert.equal(count, 2);
    assert.ok(snapshot.steps.every(s => s.step_status !== 'failed'));
    const review = snapshot.steps.find(s => s.step_status === 'rejected');
    assert.match(review.error_reason, businessError.endsWith('-shot') ? /镜头ID/ : businessError === 'costume' ? /costume_id/ : /on_screen_characters/);
    assert.ok(calls.find(c => c.kind === 'revise').messages.at(-1).content.includes(review.error_reason));
    if (businessRounds === Infinity) assert.deepEqual(snapshot.project.episodes[0].shot_list.shots, before.shots);
  });
}
test('模型内容无法解析 JSON 为未通过，网络异常仍失败', async () => {
  const { snapshot, taskId, before } = await scenario({ badJson: true });
  const task = snapshot.tasks.find(t => t.id === taskId);
  assert.equal(task.task_status, 'rejected');
  assert.match(task.end_reason, /JSON/);
  assert.deepEqual(snapshot.project.episodes[0].shot_list.shots, before.shots);
});
