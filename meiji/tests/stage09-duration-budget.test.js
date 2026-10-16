import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptParagraphs, buildSplit, paragraphNumber } from '../server/handlers/script-split.js';
import { shotsBudget } from '../server/prompts/duration-policy.js';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { emptyProject, emptyEpisode } from '../shared/project_contract.js';
import { approveScriptReview } from './fixtures/project.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { commitContent } from '../server/handlers/content.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';

const row = (sequence, from, to, seconds) => ({ 序号: sequence, 起始段落: paragraphNumber(from), 结束段落: paragraphNumber(to), 预估时长秒: seconds });

test('长段落提供完整句和完整发言切点，原文空白、嵌套引号与跨行发言逐字保留', () => {
  const script = '\n他走入大厅。他说：“第一句。第二句！还有「引语？」。”\n众人点头。他又说：“这是一段\n跨行对白。仍在发言！”\n\n众人离开。';
  const parts = scriptParagraphs(script);
  assert.equal(parts.join(''), script);
  assert.ok(parts.includes('他说：“第一句。第二句！还有「引语？」。”\n'));
  assert.ok(parts.some(p => p.includes('“这是一段\n跨行对白。仍在发言！”')));
  assert.ok(parts.length > 3);
  assert.deepEqual(scriptParagraphs('甲：第一句。第二句！\n乙：回答。'), ['甲：第一句。第二句！\n', '乙：回答。']);
  assert.equal(scriptParagraphs('他说：“引号未结束。\n仍不拆开。').length, 1);
  for (const text of ['', ' \n\r\n', '甲。乙。', '甲说："一。二！"乙离开。']) assert.equal(scriptParagraphs(text).join(''), text);
});

test('150秒参考下多段超180秒拒绝且不改候选，单个不可拆发言保留真实估时', () => {
  const script = '他到达。众人起身。双方交谈。';
  const raw = { 剧集: [row(1, 0, 2, 240)], 排除段落: [] }, before = structuredClone(raw);
  assert.throws(() => buildSplit(script, raw, 150), /超过参考150秒的容量上限180秒.*提前切集/s);
  assert.deepEqual(raw, before);
  const fixed = { 剧集: [row(1, 0, 1, 150), row(2, 2, 2, 90)], 排除段落: [] };
  assert.equal(buildSplit(script, fixed, 150).episodes.map(e => e.plot).join(''), script);
  const speech = '甲：' + '这是完整发言。'.repeat(80);
  assert.equal(buildSplit(speech, { 剧集: [row(1, 0, 0, 300)], 排除段落: [] }, 150).episodes[0].duration_seconds, 300);
  assert.equal(buildSplit(script, { 剧集: [row(1, 0, 2, 180)], 排除段落: [] }, 150).episodes[0].duration_seconds, 180);
});

test('时长预算累计舍入，不把各段独立取整误差带入镜头目标', () => {
  const segments = [10.5, 10.5, 10.5].map((duration_seconds, i) => ({ sequence: i + 1, duration_seconds }));
  const budget = shotsBudget(segments);
  assert.deepEqual(budget.segments.map(s => s.budget_seconds), [11, 10, 11]);
  assert.equal(budget.target_seconds, 32);
  assert.ok(budget.segments.every(s => s.min_shots === 1 && s.max_shots === 2));
  const input = { language: 'zh-CN', requirements: '', segments, duration: 150, characters: [] };
  for (const action of ['generate', 'regenerate', 'review']) {
    const prompt = composeNodePrompt('shots', action, action === 'generate' ? input : { ...input, opinion: '检查时长', content: { shots: [] } }, 'codex-gpt');
    assert.match(prompt.messages[1].content, /"target_seconds": 32/);
    assert.match(prompt.messages[1].content, /"budget_seconds": 11/);
    assert.doesNotMatch(prompt.body, /仍须逐段同时修改|不能只改其中一项|仍须逐段修改该段镜头的/);
  }
});

test('旧切点修订映射细粒度编号，仍逐字恢复对应剧情', () => {
  const script = '第一件事。第二件事。他说：“一。二。”第三件事。';
  const project = emptyProject({ name: '切点映射', creation_mode: '剧本' });
  project.script.body = script;
  project.episodes = [emptyEpisode({ sequence: 1, plot: '第一件事。第二件事。' }), emptyEpisode({ sequence: 2, plot: '他说：“一。二。”第三件事。' })];
  const input = taskNodeInput({ project, steps: [] }, { business_type: 'script-split', target_id: project.id, opinion: '检查容量' }, null, 'regenerate');
  assert.equal(buildSplit(script, input.content, 150).episodes.map(e => e.plot).join(''), script);
  assert.equal(input.content.剧集[1].起始段落, 'P003');
});

test('容量拒绝进入既有修订，明确重切后只写成功结果，提交入口同样拒绝超量', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-duration-capacity-'));
  let runtime, calls = 0;
  const script = '他走入大厅。众人起身。双方交谈。客人离开。';
  const over = { 剧集: [row(1, 0, 3, 300)], 排除段落: [] };
  const fixed = { 剧集: [row(1, 0, 1, 150), row(2, 2, 3, 150)], 排除段落: [] };
  try {
    runtime = await createAppRuntime({ home, gateway: { chat: async ({ messages, step }) => {
      if (step.kind === "review") return { 是否通过: true, 原因: "" };
      calls++;
      if (calls > 1) {
        assert.match(messages.at(-1).content, /容量上限180秒/);
        assert.match(messages.at(-1).content, /提前切集/);
      }
      return calls === 1 ? over : fixed;
    } } });
    const project = approveScriptReview(emptyProject({ name: '容量', creation_mode: '剧本' }));
    project.script.body = script;
    // 设置正文后重新标记已审核，保证precheck读取本轮剧本hash。
    approveScriptReview(project);
    project.episodes = [emptyEpisode({ plot: '旧正式剧情' })];
    const old = structuredClone(project.episodes);
    assert.throws(() => commitContent({ project }, { business_type: 'script-split', target_id: project.id }, over, { passed: true }), /容量上限180秒/);
    assert.deepEqual(project.episodes, old);
    const model = await runtime.repository.create(project);
    const task = await runtime.tasks.command({ type: 'submit', project_id: project.id, target_id: project.id, business_type: 'script-split', action: 'regenerate', request_id: 'duration-test' });
    await runtime.tasks.idle(project.id);
    const snapshot = model.read();
    assert.equal(snapshot.tasks.find(t => t.id === task.task_id).task_status, 'completed');
    assert.equal(calls, 2);
    assert.equal(snapshot.project.episodes.map(e => e.plot).join(''), script);
    assert.equal(snapshot.steps.filter(s => s.kind === 'review' && s.step_status === 'rejected').length, 1);
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
});

for (const repair of [true, false]) test(`数值合规但语义容量不足：${repair ? '带具体切点修订后保存' : '耗尽修订不覆盖旧剧集'}`, async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-semantic-capacity-'));
  let runtime, generations = 0, reviews = 0;
  const script = '甲发问。乙解释完整方案。众人依次搬运物件。最后确认完成。';
  const first = { 剧集: [row(1, 0, 3, 150)], 排除段落: [] };
  const fixed = { 剧集: [row(1, 0, 1, 140), row(2, 2, 3, 100)], 排除段落: [] };
  const reason = '第1集P002—P003：乙须先解释方案，众人才依次搬运，解释与搬运不能并行；150秒无法正常呈现。请在P002完整发言结束后切集，P003起归入下一集。';
  try {
    runtime = await createAppRuntime({ home, gateway: { chat: async ({ step, messages }) => {
      if (step.kind === 'review') {
        reviews++;
        assert.match(messages[0].content, /不得按字符数、字数、句数或固定每秒字数折算/);
        return repair && reviews > 1 ? { 是否通过: true, 原因: '' } : { 是否通过: false, 原因: reason };
      }
      generations++;
      if (generations > 1) assert.ok(messages.at(-1).content.includes(reason));
      return repair && generations > 1 ? fixed : first;
    } } });
    const project = emptyProject({ name: '语义容量', creation_mode: '剧本' });
    project.script.body = script; approveScriptReview(project);
    project.episodes = [emptyEpisode({ plot: '原有剧情' })];
    const original = structuredClone(project.episodes), model = await runtime.repository.create(project);
    const result = await runtime.tasks.command({ type: 'submit', project_id: project.id, target_id: project.id, business_type: 'script-split', action: 'regenerate', request_id: 'semantic-test' });
    await runtime.tasks.idle(project.id);
    const snapshot = model.read();
    assert.equal(snapshot.tasks.find(t => t.id === result.task_id).task_status, repair ? 'completed' : 'rejected');
    assert.equal(generations, repair ? 2 : 3);
    assert.equal(reviews, generations);
    const rejected = snapshot.steps.filter(s => s.kind === 'review' && s.step_status === 'rejected');
    assert.ok(rejected.every(s => s.name.includes('AI审核') && s.error_reason === reason));
    if (repair) assert.equal(snapshot.project.episodes.map(e => e.plot).join(''), script);
    else assert.deepEqual(snapshot.project.episodes, original);
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
});
