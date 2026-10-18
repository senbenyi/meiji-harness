import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { snapshotFixture, taskFixture, projectFixture, approveScriptReview } from "./fixtures/project.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppRuntime } from "../server/runtime/app-runtime.js";

describe("character-types", () => {
  for (const kind of ['generate', 'revise']) {
    test(`角色 ${kind} 接受道具及特征数组，拒绝字符串与非文本成员`, async () => {
      const snapshot = snapshotFixture();
      const task = taskFixture(snapshot.project, 'project-characters', snapshot.project.id);
      const person = { name: '甲', gender: '男', era: '宋代', position: '', age_range: '', body_type: '', hairstyle: '', facial_features: '', height: '', nationality: '', voice: '',
        signature_props: ['哨棒', '竹篮'], immutable_traits: ['眉骨分明', '右手虎口旧疤'],
        costumes: [{ name: '短衣', color: '', material: '', props: [] }] };
      let candidate = person;
      const handler = createTextHandler({ chat: async () => {
        return { characters: [candidate] };
      } });
      const run = () => handler({ snapshot, task, step: { kind, seq: 1 }, record: async () => {} });
      const saved = (await run()).content.characters[0];
      assert.deepEqual(saved.signature_props, person.signature_props);
      assert.deepEqual(saved.immutable_traits, person.immutable_traits);
      assert.deepEqual(saved.costumes[0].props, []);
      for (const field of ['signature_props', 'immutable_traits', 'props']) {
        for (const invalid of ['', '道具', null, [1], [{}]]) {
          candidate = structuredClone(person);
          if (field === 'props') candidate.costumes[0].props = invalid;
          else candidate[field] = invalid;
          const rejected = await run();
          assert.match(rejected.validationFailure, new RegExp(field));
          assert.equal(rejected.content, null);
        }
      }
    });
  }
});

describe("character-completion", () => {
  const script = '近代工业时期，大学者臬科尔是反对月界旅行的社员。他穿灰色外套，说：“我反对。”他与社长争辩后离开。其余围观者议论纷纷。';
  const person = () => ({
    name: '臬科尔', gender: '男', era: '近代工业时期', position: '反对月界旅行的社员', age_range: '中年',
    body_type: '中等体格，肩背挺直', hairstyle: '深色短发，梳理整齐', facial_features: '长方脸，眉骨清晰', height: '身量偏高', nationality: '', voice: '中低音，吐字清楚',
    signature_props: [], immutable_traits: [], costumes: [{ name: '灰色外套', color: '灰色', material: '羊毛呢', props: [] }],
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
});
