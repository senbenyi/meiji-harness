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
import { projectFixture } from './fixtures/project.js';

async function scenario({ missingRounds = 0, empty = false, network = false, badReview = false, business = 'shots' } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-missing-review-'));
  const project = projectFixture(), episode = project.episodes[0];
  const fields = ['title', 'number', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement'];
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
    const candidate = structuredClone(valid);
    if (count <= missingRounds) {
      if (business === 'shots') delete candidate.shots[0].audio_arrangement;
      else delete candidate.characters[0].gender;
    }
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

for (const empty of [false, true]) test(`缺字段修订耗尽为未通过，保留${empty ? '空节点' : '旧正文及hash'}`, async () => {
  const { snapshot, taskId, count, before } = await scenario({ missingRounds: Infinity, empty });
  const task = snapshot.tasks.find(t => t.id === taskId), node = snapshot.project.episodes[0].shot_list;
  assert.equal(task.task_status, 'rejected');
  assert.equal(count, 3);
  assert.equal(node.node_state.status, 'rejected');
  assert.equal(node.node_state.reason, task.end_reason);
  assert.deepEqual(node.shots, before.shots);
  assert.equal(node.node_state.dependency_hash, before.node_state.dependency_hash);
  const steps = snapshot.steps.filter(s => s.task_id === taskId);
  assert.equal(steps.filter(s => s.step_status === 'rejected').length, 3);
  assert.equal(Object.hasOwn(steps.find(s => s.kind === 'generate').result.shots[0], 'audio_arrangement'), false);
  assert.ok(steps.every(s => s.step_status !== 'failed'));
});

test('原无程序审核的角色节点缺字段也执行结构程序审核并修复', async () => {
  const { snapshot, taskId, count } = await scenario({ business: 'project-characters', missingRounds: 1 });
  assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'completed', snapshot.tasks.find(t => t.id === taskId).end_reason);
  assert.equal(count, 2);
  assert.ok(snapshot.steps.some(s => s.task_id === taskId && s.step_status === 'rejected' && /程序审核/.test(s.name)));
});

for (const options of [{ network: true }, { badReview: true }]) test(`${options.network ? '网络接口异常即使包含缺字段文案' : '审核接口缺协议字段'}仍失败且不进入业务修订`, async () => {
  const { snapshot, taskId, calls, before } = await scenario(options);
  assert.equal(snapshot.tasks.find(t => t.id === taskId).task_status, 'failed');
  assert.ok(!calls.some(c => c.kind === 'revise'));
  assert.deepEqual(snapshot.project.episodes[0].shot_list, before);
});
