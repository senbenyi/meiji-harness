import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import promptModel from '../server/prompts/models/project-characters.js';
import { composeNodePrompt, validateNodeResult } from '../server/http/ai-routes.js';
import { nodeRules } from '../server/http/node-rules.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { projectFixture, approveScriptReview } from './fixtures/project.js';

const script = '近代工业时期，大学者臬科尔是反对月界旅行的社员。他穿灰色外套，说：“我反对。”他与社长争辩后离开。其余围观者议论纷纷。';
const person = () => ({
  name: '臬科尔', gender: '男', era: '近代工业时期', position: '反对月界旅行的社员', age_range: '中年',
  body_type: '中等体格，肩背挺直', hairstyle: '深色短发，梳理整齐', facial_features: '长方脸，眉骨清晰', height: '身量偏高', nationality: '', voice: '中低音，吐字清楚',
  signature_props: [], immutable_traits: [], costumes: [{ name: '灰色外套', color: '灰色', material: '羊毛呢', props: [] }],
});
const input = (fields = {}) => ({ language: 'zh-CN', requirements: '', script, characters: [], opinion: '', content: { characters: [person()] }, ...fields });

test('人物生成/修订/审核共用补全口径，真实渲染与规则面板不再要求来源标签或逐字照抄', () => {
  const details = promptModel.generate.system.规则.资料提取与补全;
  assert.equal(promptModel.regenerate.system.规则.资料提取与补全, details);
  assert.equal(promptModel.review.system.规则.资料提取与补全, details);
  const costumes = promptModel.generate.system.规则.服装套数与补全;
  assert.equal(promptModel.regenerate.system.规则.服装套数与补全, costumes);
  assert.equal(promptModel.review.system.规则.服装套数与补全, costumes);
  for (const model of ['codex-gpt', 'qwen3.5:27b']) for (const action of ['generate', 'regenerate', 'review']) {
    const args = input(); if (action === 'generate') { delete args.content; delete args.opinion; }
    const rendered = composeNodePrompt('project-characters', action, args, model);
    assert.doesNotMatch(rendered.system, /句末标“背景补”|必须含“背景补”|原样保留|原文有则必须保留原句/);
    assert.match(rendered.system, /自由补充/);
    assert.match(rendered.system, /不要求照抄原句/);
    assert.match(rendered.system, /只补一套/);
    assert.match(rendered.system, /大致相同的服装归为一套/);
    assert.match(rendered.system, /只有完整剧本明确该角色实际换装/);
    assert.match(rendered.system, /不以保留旧设定为由继续沿用/);
    assert.match(rendered.system, /未提取这类人物不是遗漏/);
    if (action === 'review') {
      assert.match(rendered.system, /报告遗漏时必须写出缺少的具体姓名/);
      assert.match(rendered.system, /该项不是错误，不能再用它拒绝/);
      assert.match(rendered.system, /其余服装、字段等独立问题仍照常审核/);
    }
    if (action === 'regenerate') {
      assert.equal(rendered.messages.filter(m => m.role === 'assistant').length, 1);
      assert.deepEqual(JSON.parse(rendered.messages.find(m => m.role === 'assistant').content), args.content);
    }
  }
  const rules = nodeRules('project-characters');
  for (const key of ['generate', 'revise', 'review']) {
    assert.doesNotMatch(rules[key], /句末标“背景补”|必须含“背景补”|原样保留/);
    assert.match(rules[key], /自由补充/);
    assert.match(rules[key], /不得把完整角色名单缩小到这一个人/);
    assert.match(rules[key], /补全细节不等于新增服装造型/);
    assert.match(rules[key], /此排除优先于剧情重要性与名单完整性要求/);
  }
  assert.match(rules.review, /不因未列全称号、经历或某个原文形容词拒绝/);
  assert.match(rules.review, /无剧本依据增加服装套数、近似服装重复建套/);
  const candidate = { characters: [person()] };
  assert.doesNotThrow(() => validateNodeResult('project-characters', 'generate', candidate, input()));
  const invalid = structuredClone(candidate); invalid.characters[0].signature_props = '眼镜';
  assert.throws(() => validateNodeResult('project-characters', 'generate', invalid, input()), /数组/);
});

async function fixture(work, respond) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-character-completion-'));
  let runtime;
  const calls = [];
  try {
    runtime = await createAppRuntime({ home, gateway: {
      chat: async options => { calls.push(options); return respond(options, calls); },
      image: async () => { throw new Error('人物提取不能派生图片'); },
    } });
    const p = projectFixture(); p.script.body = script; approveScriptReview(p);
    const model = await runtime.repository.create(p);
    const submit = async (fields = {}) => {
      const result = await runtime.tasks.command({ type: 'submit', project_id: p.id, target_id: p.id, business_type: 'project-characters', action: 'generate', request_id: crypto.randomUUID(), ...fields });
      await runtime.tasks.idle(p.id);
      return runtime.repository.history(p.id).task(result.task_id);
    };
    await work({ runtime, p, model, calls, submit });
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
}

test('无来源标签的完整人物走真实任务链首次通过；原结果描述优化保留角色/服装ID，不派生图片', () => fixture(async ({ runtime, p, model, calls, submit }) => {
  const first = await submit(); assert.equal(first.task_status, 'completed', first.end_reason);
  const a = model.read().project.character_library.characters[0];
  assert.equal(a.position, '反对月界旅行的社员'); assert.equal(a.costumes[0].material, '羊毛呢');
  assert.equal(calls.length, 2, '只生成和审核一次，不因设定非原文而自动修订');
  assert.deepEqual(runtime.repository.history(p.id).stepsOf(first.id).map(s => s.kind), ['precheck', 'generate', 'review']);
  const second = await submit({ action: 'revise', opinion: '把面部描述写得更清楚，其他保持' });
  assert.equal(second.task_status, 'completed', second.end_reason);
  const b = model.read().project.character_library.characters[0];
  assert.equal(b.id, a.id); assert.equal(b.costumes[0].id, a.costumes[0].id);
  assert.equal(b.facial_features, '长方脸，眉骨清晰，眼窝略深');
  assert.equal(b.costumes[0].color, '灰色'); assert.deepEqual(b.signature_props, []);
  assert.equal(calls.length, 4);
  const assistant = calls[2].messages.find(m => m.role === 'assistant');
  assert.equal(JSON.parse(assistant.content).characters[0].facial_features, a.facial_features);
  assert.ok(calls.every(c => !/句末标“背景补”|必须含“背景补”/.test(c.messages[0].content)));
  assert.ok(model.readAll().tasks.every(t => t.business_type === 'project-characters'));
  assert.ok(b.costume_images.every(image => !image.address));
}, ({ step, task }) => step.kind === 'review'
  ? { 是否通过: true, "类型": "", 原因: '' }
  : { characters: [{ ...person(), ...(task.action === 'revise' ? { facial_features: '长方脸，眉骨清晰，眼窝略深' } : {}) }] }));

test('资料确有缺项时审核定向修订，本轮基稿只出现一次，补全后保留其余设定并通过', () => fixture(async ({ runtime, p, model, calls, submit }) => {
  const task = await submit(); assert.equal(task.task_status, 'completed', task.end_reason);
  assert.deepEqual(calls.map(c => c.step.kind), ['generate', 'review', 'revise', 'review']);
  assert.equal(model.read().project.character_library.characters[0].voice, person().voice);
  assert.equal(model.read().project.character_library.characters[0].costumes[0].material, person().costumes[0].material);
  const revision = calls.find(c => c.step.kind === 'revise');
  assert.equal(revision.messages.filter(m => m.role === 'assistant').length, 1);
  assert.equal(JSON.parse(revision.messages.find(m => m.role === 'assistant').content).characters[0].voice, '');
  assert.match(revision.messages.at(-1).content, /voice缺少可执行声线/);
  const steps = runtime.repository.history(p.id).stepsOf(task.id);
  assert.equal(steps.filter(s => s.kind === 'revise').length, 1);
  assert.equal(steps.find(s => s.kind === 'review').step_status, 'rejected');
}, ({ step, trace }) => {
  if (step.kind === 'review') return trace.input.content.characters[0].voice
    ? { 是否通过: true, "类型": "", 原因: '' }
    : { 是否通过: false, "类型": "模型问题", 原因: 'voice缺少可执行声线，请补充音色与说话特点' };
  return { characters: [{ ...person(), ...(step.kind === 'generate' ? { voice: '' } : {}) }] };
}));
