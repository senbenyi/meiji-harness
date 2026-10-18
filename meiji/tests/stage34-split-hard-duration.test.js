import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { splitBudget } from '../server/prompts/duration-policy.js';
import { buildSplit } from '../server/handlers/script-split.js';
import { commitContent } from '../server/handlers/content.js';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { emptyProject, emptyEpisode } from '../shared/project_contract.js';
import { approveScriptReview } from './fixtures/project.js';

const row = (序号, 预估时长秒) => ({ 序号, 本集规划: `第${序号}集：甲发现证据，乙确认事实，结尾交接后续。`, 预估时长秒 });
const candidate = (...剧集) => ({ 剧集 });
const script = '室内，甲取出证据。乙逐项核对。甲说明来由。乙确认结果。';

for (const reference of [60, 150, 300]) test(`参考${reference}秒固定±30，边界允许，单单位与末集不豁免`, () => {
  const min = reference - 30, max = reference + 30;
  assert.deepEqual(splitBudget(reference), { target_seconds: reference, min_seconds: min, max_seconds: max, tolerance_seconds: 30 });
  for (const seconds of [min, max]) {
    const value = buildSplit('甲：完整发言。', candidate(row(1, seconds)), reference);
    assert.equal(value.episodes[0].duration_seconds, seconds);
  }
  for (const seconds of [min - 1, max + 1]) {
    const raw = candidate(row(1, reference), row(2, seconds));
    const before = structuredClone(raw);
    assert.throws(() => buildSplit(script, raw, reference), error => error.code === 'INVALID_CONTRACT' && error.message.includes('第2集') && /秒内的整数/.test(error.message));
    assert.deepEqual(raw, before);
    assert.throws(() => buildSplit('甲：完整发言。', candidate(row(1, seconds)), reference), /秒内的整数/);
  }
});

test('生成、修订、审核均从项目参考值获得同一固定秒数范围', () => {
  for (const duration of [60, 300]) for (const action of ['generate', 'regenerate', 'review']) {
    const prompt = composeNodePrompt('script-split', action, { language: 'zh-CN', requirements: '', script, duration, opinion: '检查切点', ...(action === 'generate' ? {} : { content: candidate(row(1, duration)) }) }, 'codex-gpt');
    assert.match(prompt.body, new RegExp(`"min_seconds": ${duration - 30}`));
    assert.match(prompt.body, new RegExp(`"max_seconds": ${duration + 30}`));
    assert.doesNotMatch(prompt.body, /最后一集可以更短|单个不可拆发言可以独立超|单独成集并填写真实时长/);
  }
  assert.equal(splitBudget(20).min_seconds, 1);
});

test('短尾集进入程序修订，调整规划后保存新的集间安排', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-split-short-tail-'));
  let runtime, calls = 0;
  const first = candidate(row(1, 150), row(2, 65));
  const fixed = candidate(row(1, 120), row(2, 120));
  try {
    runtime = await createAppRuntime({ home, gateway: { chat: async ({ step, messages }) => {
      if (step.kind === 'review') return { 是否通过: true, "类型": "", 原因: '' };
      if (++calls > 1) {
        assert.match(messages.at(-1).content, /第2集.*120—180秒/s);
        assert.match(messages.at(-1).content, /调整集数和事件安排/);
      }
      return calls === 1 ? first : fixed;
    } } });
    const project = emptyProject({ name: '同情景跨集', creation_mode: '剧本' });
    project.script.body = script; approveScriptReview(project);
    project.episodes = [emptyEpisode({ plot: '旧剧集' })];
    const model = await runtime.repository.create(project);
    const result = await runtime.tasks.command({ type: 'submit', project_id: project.id, target_id: project.id, business_type: 'script-split', action: 'regenerate', request_id: randomUUID() });
    await runtime.tasks.idle(project.id);
    const snapshot = model.readAll(), task = snapshot.tasks.find(t => t.id === result.task_id);
    assert.equal(task.task_status, 'completed', task.end_reason);
    assert.equal(calls, 2);
    assert.deepEqual(snapshot.project.episodes.map(e => e.plot), fixed.剧集.map(row => row.本集规划));
    assert.deepEqual(snapshot.project.episodes.map(e => e.duration_seconds), [120, 120]);
    assert.equal(snapshot.steps.filter(s => s.kind === 'review' && s.step_status === 'rejected').length, 1);
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
});

test('人工放行与提交均拦短集，数值合规的AI拒绝候选仍可人工放行', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-split-hard-override-'));
  let runtime, seconds = 65;
  try {
    runtime = await createAppRuntime({ home, gateway: { chat: async ({ step }) => step.kind === 'review' ? { 是否通过: false, "类型": "模型问题", 原因: '测试语义意见' } : candidate(row(1, seconds)) } });
    const project = emptyProject({ name: '硬条件放行', creation_mode: '剧本' });
    project.script.body = script; approveScriptReview(project);
    project.episodes = [emptyEpisode({ plot: '旧正式剧情' })];
    const old = structuredClone(project.episodes);
    const short = candidate(row(1, 65));
    for (const action of ['override', 'regenerate']) {
      assert.throws(() => commitContent({ project }, { business_type: 'script-split', target_id: project.id, action }, short), /120—180秒/);
      assert.deepEqual(project.episodes, old);
    }
    const model = await runtime.repository.create(project);
    const command = action => runtime.tasks.command({ type: action === 'override' ? 'override' : 'submit', project_id: project.id, target_id: project.id, business_type: 'script-split', ...(action === 'override' ? {} : { action }), request_id: randomUUID() });
    for (const current of [65, 150]) {
      seconds = current;
      const generated = await command('regenerate'); await runtime.tasks.idle(project.id);
      assert.equal(model.readAll().tasks.find(t => t.id === generated.task_id).task_status, 'rejected');
      const accepted = await command('override'); await runtime.tasks.idle(project.id);
      const snapshot = model.readAll(), task = snapshot.tasks.find(t => t.id === accepted.task_id);
      assert.equal(task.task_status, current === 65 ? 'rejected' : 'completed', task.end_reason);
      if (current === 65) {
        assert.match(task.end_reason, /120—180秒/);
        assert.deepEqual(snapshot.project.episodes, old);
      } else {
        assert.match(snapshot.project.episodes[0].plot, /甲发现证据/);
        assert.equal(snapshot.project.episodes[0].duration_seconds, 150);
      }
    }
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
});
