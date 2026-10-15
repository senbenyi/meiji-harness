import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent, aiProjection, prepareContent } from "../server/handlers/content.js";
import { dependencyHash, stampDependencyHash } from "../shared/node-dependencies.js";
import { renderTaskPrompt } from "./fixtures/ai.js";
import {
  projectFixture,
  taskFixture,
  snapshotFixture,
} from "./fixtures/project.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
const cases = [
  "project-summary",
  "project-characters",
  "episode-summary",
  "outline",
  "shots",
  "seconds",
  "storyboard",
];
test("角色生成与修订执行器要求性别，拒绝遗漏或空白并保存合法输出", async () => {
  const snapshot = snapshotFixture();
  const task = taskFixture(snapshot.project, "project-characters", snapshot.project.id);
  const row = { name: "新角色", gender: "女", era: "宋代", position: "主角", age_range: "", body_type: "", hairstyle: "", signature_props: [], immutable_traits: [], costumes: [] };
  for (const kind of ["generate", "revise"]) {
    for (const gender of [undefined, "  ", "女", "未明确"]) {
      const candidate = { ...row, gender };
      if (gender === undefined) delete candidate.gender;
      const handler = createTextHandler({ chat: async ({ messages }) => {
    const system = messages[0].content;
        assert.match(system, /gender/);
        assert.match(system, /必须填写非空字符串/);
        assert.doesNotMatch(system, /国籍、性别、声音/);
        return { characters: [candidate] };
      } });
      const run = () => handler({ snapshot, task, step: { kind, seq: 1 }, record: async () => {} });
      if (!gender?.trim()) await assert.rejects(run, /gender/);
      else assert.equal((await run()).content.characters.at(-1).gender, gender);
    }
  }
});
function output(p, business) {
  const episode = p.episodes[0], shot = episode.shot_list.shots[0];
  const fields = ["title", "number", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement"];
  return {
    "project-summary": "新项目摘要",
    "project-characters": { characters: [] },
    "episode-summary": "新展示摘要",
    outline: { segments: episode.story_outline.segments },
    shots: { shots: episode.shot_list.shots.map(item => Object.fromEntries(fields.map(key => [key, item[key]]))) },
    seconds: { end_state: shot.seconds_storyboard.end_state, pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: shot.seconds_storyboard.storyboard },
    storyboard: "integrated_multimodal_description\nA man walks.\noverall_soundscape\nFootsteps.\nnon_diegetic_music\nNone.",
  }[business];
}
for (const business of cases)
  for (const ending of ["completed", "rejected", "failed"])
    test(`S5-02/03/04 ${business} 真实文本执行器 ${ending}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "meiji-text-"));
      try {
        const p = projectFixture(),
          repository = new ModelRepository(root),
          model = await repository.create(p),
          target = ["project-summary", "project-characters"].includes(
            business,
          )
            ? p.id
            : ["seconds", "storyboard"].includes(business)
              ? p.episodes[0].shot_list.shots[0].id
              : p.episodes[0].id;
        let generated = 0;
        const handler = createTextHandler({
          chat: async ({ task, step }) => {
            if (step.kind === "review")
              return {
                是否通过: ending !== "rejected",
                原因: ending === "rejected" ? "未落实剧情" : "",
              };
            if (task.business_type === business) generated++;
            if (ending === "failed") return { 非法: "字段" };
            return output(p, task.business_type);
          },
        });
        const service = new TaskService({
          repository,
          execute: createHandlerRegistry({ text: handler, media: () => { throw Error("unexpected media"); } }),
          commitOutput: commitContent,
        });
        const action =
          business === "project-characters" ? "generate" : "regenerate";
        const result = await service.command({
          type: "submit",
          project_id: p.id,
          request_id: "text",
          business_type: business,
          target_id: target,
          action,
        });
        await service.idle(p.id);
        const snapshot = model.read(),
          task = snapshot.tasks.find((t) => t.id === result.task_id);
        assert.equal(task.task_status, ending, task.end_reason);
        assert.equal(generated, ending === "rejected" ? 3 : 1);
        if (ending === "rejected")
          assert.deepEqual(
            snapshot.steps
              .filter((s) => s.task_id === task.id && s.kind === "review" && s.step_status === "rejected")
              .map((s) => s.round),
            [0, 1, 2],
          );

      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
test("S5-01 所有文本模板占位符均从真实项目资料构建，不暴露内部 ID", async () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project;
  for (const business of cases) {
    const target = ["project-summary", "project-characters"].includes(
        business,
      )
        ? p.id
        : ["seconds", "storyboard"].includes(business)
          ? p.episodes[0].shot_list.shots[0].id
          : p.episodes[0].id,
      t = taskFixture(p, business, target);
    for (const suffix of ["generate", "regenerate", "review"]) {
      const prompt = renderTaskPrompt(snapshot, t, null, suffix);
      assert.ok(!prompt.system.includes(p.id));
      assert.ok(!prompt.user.includes(p.id));
    }
  }
});

test("项目摘要拒绝保存最后正文和原因，修订收到原稿且不改依赖 hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-summary-rejection-"));
  const project = projectFixture();
  const oldHash = "b".repeat(64);
  project.project_summary.node_state.dependency_hash = oldHash;
  const repository = new ModelRepository(root), model = await repository.create(project), prompts = [];
  let round = 0;
  const text = createTextHandler({ chat: async ({ step, messages }) => {
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
    if (step.kind === "review") return { 是否通过: false, 原因: "遗漏明确结局" };
    prompts.push(prompt);
    return `本轮摘要${++round}`;
  } });
  const service = new TaskService({ repository, execute: createHandlerRegistry({ text }), commitOutput: commitContent });
  try {
    const result = await service.command({ type: "submit", project_id: project.id, request_id: "summary-reject", business_type: "project-summary", target_id: project.id, action: "regenerate" });
    await service.idle(project.id);
    const snapshot = model.read(), task = snapshot.tasks.find(item => item.id === result.task_id);
    assert.equal(task.task_status, "rejected");
    assert.equal(snapshot.project.project_summary.body, "本轮摘要3");
    assert.equal(snapshot.project.project_summary.node_state.reason, "遗漏明确结局");
    assert.equal(snapshot.project.project_summary.node_state.dependency_hash, oldHash);
    assert.match(prompts[1], /本轮摘要1/);
    assert.match(prompts[1], /遗漏明确结局/);
    assert.match(prompts[2], /本轮摘要2/);
    assert.equal(snapshot.tasks.length, 1);
  } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
});

test("人物审核只接收本次增量，拒绝保存角色但不派生图片或更新 hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-character-rejection-"));
  const project = projectFixture(), oldHash = "c".repeat(64);
  project.character_library.node_state.dependency_hash = oldHash;
  const repository = new ModelRepository(root), model = await repository.create(project), prompts = [];
  const row = { name: "新人物", gender: "男", era: "宋代", position: "主角", age_range: "约三十岁", body_type: "高大", hairstyle: "束发", signature_props: [], immutable_traits: [], costumes: [] };
  const text = createTextHandler({ chat: async ({ step, messages }) => {
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
    prompts.push({ kind: step.kind, prompt });
    return step.kind === "review" ? { 是否通过: false, 原因: "人物来源有误" } : { characters: [row] };
  } });
  const service = new TaskService({ repository, execute: createHandlerRegistry({ text }), commitOutput: commitContent });
  try {
    const result = await service.command({ type: "submit", project_id: project.id, request_id: "characters-reject", business_type: "project-characters", target_id: project.id, action: "generate" });
    await service.idle(project.id);
    const snapshot = model.read(), node = snapshot.project.character_library;
    assert.equal(snapshot.tasks.find(item => item.id === result.task_id).task_status, "rejected");
    assert.equal(node.node_state.dependency_hash, oldHash);
    assert.equal(node.characters[0].name, "新人物");
    assert.equal(node.characters[0].gender, "男");
    assert.equal(node.characters[0].era, "宋代");
    assert.equal(node.characters[0].age_range, "约三十岁");
    assert.deepEqual(node.characters[0].costumes, []);
    assert.equal(node.characters[0].costume_images[0].costume_id, "");
    assert.equal(snapshot.tasks.length, 1);
    for (const { prompt } of prompts.filter(item => item.kind === "review")) {
      assert.match(prompt, /新人物/);
      assert.match(prompt, /"gender":\s*"男"/);
      assert.match(prompt, /"era":\s*"宋代"/);
      assert.doesNotMatch(prompt, /new_ids|node_state|c_[0-9a-f-]{36}/);
    }
    assert.match(prompts.find(item => item.kind === "revise").prompt, /人物来源有误/);
    assert.match(prompts.find(item => item.kind === "revise").prompt, /新人物/);
    assert.match(prompts.find(item => item.kind === "revise").prompt, /"gender":\s*"男"/);
    assert.match(prompts.find(item => item.kind === "revise").prompt, /"era":\s*"宋代"/);
  } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
});

for (const change of ["character", "costume"])
  for (const action of ["regenerate", "override"])
    test(`S5-角色拒绝候选经 ${action} 通过后按生成时依赖使 ${change} 图片过期`, () => {
      const snapshot = snapshotFixture(), project = snapshot.project;
      const task = taskFixture(project, "project-characters", project.id, { action: "generate" });
      const row = name => ({ name, gender: "男", era: "宋代", position: "主角", age_range: "三十岁", body_type: "高大", hairstyle: "束发", signature_props: [], immutable_traits: [], costumes: [{ name: "长袍", color: "蓝色", material: "布", props: [] }] });
      commitContent(snapshot, task, prepareContent(snapshot, task, { characters: [row("甲"), row("乙")] }));
      for (const character of project.character_library.characters) {
        character.costume_images[0].address = `${character.name}.png`;
        character.costume_images[0].node_state.status = "generated";
        stampDependencyHash(snapshot, "character-image", character.id);
        character.costume_images[0].address = `${character.name}-衣服.png`;
        character.costume_images[0].node_state.status = "generated";
        stampDependencyHash(snapshot, "costume-image", character.costumes[0].id);
      }
      const changed = row("甲");
      if (change === "character") changed.position = "反派";
      else changed.costumes[0].color = "红色";
      const content = prepareContent(snapshot, task, { characters: [changed] });
      commitContent(snapshot, task, content, { passed: false });
      const [first, second] = project.character_library.characters;
      const imageHash = first.costume_images[0].node_state.dependency_hash;
      const costumeHash = first.costume_images[0].node_state.dependency_hash;
      assert.equal(first.costume_images[0].node_state.status, "generated");
      assert.equal(first.costume_images[0].node_state.status, "generated");
      assert.notEqual(costumeHash, dependencyHash(snapshot, "costume-image", first.costumes[0].id));
      commitContent(snapshot, { ...task, action }, content);
      const [accepted, untouched] = project.character_library.characters;
      assert.equal(accepted.costume_images[0].node_state.dependency_hash, imageHash);
      assert.equal(accepted.costume_images[0].node_state.status, "expired");
      assert.equal(accepted.costume_images[0].node_state.status, "expired");
      assert.equal(accepted.costume_images[0].node_state.dependency_hash, costumeHash);
      assert.equal(untouched.id, second.id);
      assert.equal(untouched.costume_images[0].node_state.status, "generated");
      assert.equal(untouched.costume_images[0].node_state.status, "generated");
    });

test("重新提取角色不提交已有角色库，首次生成和审核仍提交", async () => {
  const project = projectFixture();
  const character = emptyCharacterModel({ number: "C01", name: "库内独有姓名甲", gender: "男", era: "宋代" });
  project.character_library.characters = [character];
  project.script.body = "剧本只写了另一人。";
  const snapshot = { project, tasks: [], steps: [] };
  const seen = [];
  const handler = createTextHandler({ chat: async ({ messages, step }) => {
    seen.push(messages.map(message => message.content).join("\n"));
    if (step.kind === "review") return { 是否通过: true, 原因: "" };
    return { characters: [] };
  } });
  const run = (action, kind) => handler({
    snapshot, task: taskFixture(project, "project-characters", project.id, { action }),
    step: { kind, seq: 1 }, draft: null, signal: new AbortController().signal, record: async () => {},
  });
  await run("regenerate", "generate");
  assert.doesNotMatch(seen[0], /# 项目角色库目录|库内独有姓名甲|costume_images/);
  await run("generate", "generate");
  assert.match(seen[1], /# 项目角色库目录/);
  assert.match(seen[1], /库内独有姓名甲/);
  await run("regenerate", "review");
  assert.match(seen[2], /# 项目角色库目录/);
  assert.match(seen[2], /库内独有姓名甲/);
});

test("提取仅写人物，每个人物独立生成全部服装，空服装生成一张", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-character-group-"));
  const repository = new ModelRepository(root), project = projectFixture(), model = await repository.create(project);
  const person = (name, costumes) => ({ name, gender: "男", era: "宋代", position: "主角", age_range: "成年", body_type: "健壮", hairstyle: "短发", signature_props: [], immutable_traits: [], costumes });
  const characters = [
    person("甲", [{ name: "常服", color: "蓝色", material: "棉", props: [] }, { name: "礼服", color: "红色", material: "丝绸", props: [] }]),
    person("乙", []),
  ];
  let extractionCalls = 0;
  const imageCalls = [];
  const text = createTextHandler({ chat: async ({ step }) => {
    if (step.kind === "review") return { 是否通过: true, 原因: "" };
    return { characters: extractionCalls++ === 0 ? characters : [] };
  } });
  const service = new TaskService({ repository, commitOutput: commitContent, execute: createHandlerRegistry({
    text,
    media: async ({ snapshot, task }) => {
      imageCalls.push({ group_id: task.group_id, business_type: task.business_type, target_id: task.target_id });
      return { content: { address: `${task.id}.png` } };
    },
  }) });
  try {
    let originalIds;
    for (const action of ["generate", "regenerate"]) {
      const result = await service.command({ type: "submit", project_id: project.id, request_id: `characters-${action}`, business_type: "project-characters", target_id: project.id, action });
      await service.idle(project.id);
      const snapshot = model.read(), [first, second] = snapshot.project.character_library.characters;
      const groupId = snapshot.tasks.find(task => task.id === result.task_id).group_id;
      assert.equal(snapshot.tasks.filter(task => task.group_id === groupId).length, 1);
      const expected = [["costume-image", first.costumes[0].id], ["costume-image", first.costumes[1].id], ["costume-image", second.id]];
      const ids = expected.map(([, id]) => id);
      for (const character of [first, second]) {
        const pictures = await service.command({ type: "submit-costumes", project_id: project.id, request_id: `${character.id}-${action}`, target_id: character.id, action });
        await service.idle(project.id);
        const tasks = model.read().tasks.filter(task => task.group_id === pictures.group_id);
        assert.ok(tasks.every(task => task.task_status === "completed"), tasks.map(t => t.end_reason).join("\n"));
        assert.deepEqual(tasks.map(task => task.target_id), character.costumes.length ? character.costumes.map(costume => costume.id) : [character.id]);
      }
      Object.assign(second, model.read().project.character_library.characters[1]);
      assert.deepEqual(second.costumes, []);
      assert.equal(second.costume_images.length, 1);
      assert.equal(second.costume_images[0].costume_id, "");
      assert.equal(second.costume_images[0].node_state.status, "generated");
      assert.ok(second.costume_images[0].address);

      if (originalIds) assert.deepEqual(ids, originalIds);
      else originalIds = ids;
    }
    assert.equal(extractionCalls, 2);
    assert.equal(imageCalls.length, 6);
  } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
});
