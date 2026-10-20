import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestTextHandler as createTextHandler, renderTaskPrompt, createTestTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent, prepareContent } from "../server/handlers/content.js";
import { dependencyHash, stampDependencyHash } from "../shared/node-dependencies.js";
import { projectFixture, taskFixture, snapshotFixture } from "./fixtures/project.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { validateCommand } from "../shared/task_contract.js";

describe("text-tasks", () => {
  test('文本漏Shot标记保留原候选进入正常修订，修订后审核通过，不取消后续任务', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meiji-marker-repair-'));
    const repository = new ModelRepository(root), p = projectFixture();
    const model = await repository.create(p), shot = p.episodes[0].shot_list.shots[0];
    const valid = output(p, 'storyboard'), missing = valid.replace('[Shot 1] ', '');
    const requests = [];
    const text = createTextHandler({ chat: async ({ step, messages }) => {
      requests.push({ kind: step.kind, messages });
      if (step.kind === 'review') return { 是否通过: true, 类型: '', 原因: '' };
      return step.kind === 'revise' ? valid : missing;
    } });
    const service = new TaskService({ repository, commitOutput: commitContent, execute: createHandlerRegistry({ text }) });
    try {
      const { task_id } = await service.command({ type: 'submit', project_id: p.basic_info.id, business_type: 'storyboard', target_id: shot.id, action: 'regenerate', opinion: '', request_id: 'marker-repair' });
      await service.idle(p.basic_info.id);
      const state = model.readAll(), task = state.tasks.find(t => t.id === task_id);
      assert.equal(task.task_status, 'completed', task.end_reason);
      const rejection = state.steps.find(s => s.task_id === task_id && s.step_status === 'rejected');
      assert.equal(rejection.executor, 'program');
      assert.match(rejection.error_reason, /Shot 1/);
      const revision = requests.find(r => r.kind === 'revise');
      assert.equal(revision.messages[2].content, missing);
      assert.match(revision.messages.at(-1).content, /Shot 1/);
      assert.match(state.project.episodes[0].shot_list.shots[0].text_to_video_prompt.integrated_multimodal_description, /\[Shot 1\]/);
    } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
  });
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
    const task = taskFixture(snapshot.project, "project-characters", snapshot.project.basic_info.id);
    const row = { name: "新角色", gender: "女", era: "宋代", position: "主角", age_range: "", body_type: "", hairstyle: "", facial_features: "", height: "", nationality: "", voice: "", signature_props: [], immutable_traits: [], costumes: [] };
    for (const kind of ["generate", "revise"]) {
      for (const gender of [undefined, "  ", "女", "未明确"]) {
        const candidate = { ...row, gender };
        if (gender === undefined) delete candidate.gender;
        const handler = createTextHandler({ chat: async () => {
          return { characters: [candidate] };
        } });
        const run = () => handler({ snapshot, task, step: { kind, seq: 1 }, record: async () => {} });
        if (gender === undefined) {
          const output = await run();
          assert.match(output.validationFailure, /gender.*缺少字段/);
          assert.equal(output.content, null);
        } else if (!gender.trim()) {
          assert.match((await run()).validationFailure, /gender/);
        }
        else assert.equal((await run()).content.characters.at(-1).gender, gender);
      }
    }
  });
  function output(p, business) {
    const episode = p.episodes[0], shot = episode.shot_list.shots[0];
    const fields = ["title", "id", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement", "on_screen_characters", "background_characters"];
    return {
      "project-summary": "新项目摘要",
      "project-characters": { characters: [] },
      "episode-summary": "新展示摘要",
      outline: { segments: episode.story_outline.segments },
      shots: { shots: episode.shot_list.shots.map(item => Object.fromEntries(fields.map(key => [key, item[key]]))) },
      seconds: { end_state: shot.seconds_storyboard.end_state, pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: shot.seconds_storyboard.storyboard },
      storyboard: "integrated_multimodal_description\n[Shot 1] A man walks.\noverall_soundscape\nFootsteps.\nnon_diegetic_music\nNone.",
    }[business];
  }
  for (const business of cases)
    for (const ending of ["completed", "rejected", "failed"])
      test(`${business} 真实文本执行器 ${ending}`, async () => {
        const root = await mkdtemp(join(tmpdir(), "meiji-text-"));
        try {
          const p = projectFixture(),
            repository = new ModelRepository(root),
            model = await repository.create(p),
            target = ["project-summary", "project-characters"].includes(
              business,
            )
              ? p.basic_info.id
              : ["seconds", "storyboard"].includes(business)
                ? p.episodes[0].shot_list.shots[0].id
                : p.episodes[0].id;
          let generated = 0;
          const handler = createTextHandler({
            chat: async ({ task, step }) => {
              if (step.kind === "review")
                return {
                  是否通过: ending !== "rejected", "类型": (ending !== "rejected") ? "" : "模型问题",
                  原因: ending === "rejected" ? "未落实剧情" : "",
                };
              if (task.business_type === business) generated++;
              if (ending === "failed") throw new Error("HTTP 503 网络接口异常");
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
            project_id: p.basic_info.id,
            request_id: "text",
            business_type: business,
            target_id: target,
            action,
          });
          await service.idle(p.basic_info.id);
          const snapshot = model.readAll(),
            task = snapshot.tasks.find((t) => t.id === result.task_id);
          assert.equal(task.task_status, ending, task.end_reason);
          assert.equal(generated, ending === "rejected" ? 4 : 1);
          if (ending === "rejected")
            assert.deepEqual(
              snapshot.steps
                .filter((s) => s.task_id === task.id && s.kind === "review" && s.step_status === "rejected")
                .map((s) => s.round),
              [0, 1, 2, 3],
            );

        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
  test("所有文本模板占位符均从真实项目资料构建，不暴露内部 ID", async () => {
    const snapshot = snapshotFixture(),
      p = snapshot.project;
    for (const business of cases) {
      const target = ["project-summary", "project-characters"].includes(
          business,
        )
          ? p.basic_info.id
          : ["seconds", "storyboard"].includes(business)
            ? p.episodes[0].shot_list.shots[0].id
            : p.episodes[0].id,
        t = taskFixture(p, business, target);
      for (const suffix of ["generate", "regenerate", "review"]) {
        const prompt = renderTaskPrompt(snapshot, t, null, suffix);
        assert.ok(!prompt.system.includes(p.basic_info.id));
        assert.ok(!prompt.user.includes(p.basic_info.id));
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
      if (step.kind === "review") return { 是否通过: false, "类型": "模型问题", 原因: "遗漏明确结局" };
      prompts.push(prompt);
      return `本轮摘要${++round}`;
    } });
    const service = new TaskService({ repository, execute: createHandlerRegistry({ text }), commitOutput: commitContent });
    try {
      const result = await service.command({ type: "submit", project_id: project.basic_info.id, request_id: "summary-reject", business_type: "project-summary", target_id: project.basic_info.id, action: "regenerate" });
      await service.idle(project.basic_info.id);
      const snapshot = model.readAll(), task = snapshot.tasks.find(item => item.id === result.task_id);
      assert.equal(task.task_status, "rejected");
      assert.equal(snapshot.project.project_summary.body, "本轮摘要4");
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
    const row = { name: "新人物", gender: "男", era: "宋代", position: "主角", age_range: "约三十岁", body_type: "高大", hairstyle: "束发", facial_features: "方脸（背景补）", height: "中等身高（背景补）", nationality: "", voice: "低沉（背景补）", signature_props: [], immutable_traits: [], costumes: [] };
    const text = createTextHandler({ chat: async ({ step, messages }) => {
      const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
      prompts.push({ kind: step.kind, prompt });
      return step.kind === "review" ? { 是否通过: false, "类型": "模型问题", 原因: "人物来源有误" } : { characters: [row] };
    } });
    const service = new TaskService({ repository, execute: createHandlerRegistry({ text }), commitOutput: commitContent });
    try {
      const result = await service.command({ type: "submit", project_id: project.basic_info.id, request_id: "characters-reject", business_type: "project-characters", target_id: project.basic_info.id, action: "generate" });
      await service.idle(project.basic_info.id);
      const snapshot = model.readAll(), node = snapshot.project.character_library;
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
        assert.match(prompt, /"facial_features":\s*"方脸（背景补）"/);
        assert.match(prompt, /"height":\s*"中等身高（背景补）"/);
        assert.match(prompt, /"voice":\s*"低沉（背景补）"/);
        assert.doesNotMatch(prompt, /new_ids|node_state|c_[0-9a-f-]{36}/);
      }
      assert.match(prompts.find(item => item.kind === "revise").prompt, /人物来源有误/);
      assert.match(prompts.find(item => item.kind === "revise").prompt, /新人物/);
      assert.match(prompts.find(item => item.kind === "revise").prompt, /"gender":\s*"男"/);
      assert.match(prompts.find(item => item.kind === "revise").prompt, /"era":\s*"宋代"/);
      assert.match(prompts.find(item => item.kind === "revise").prompt, /"facial_features":\s*"方脸（背景补）"/);
      assert.match(prompts.find(item => item.kind === "revise").prompt, /"voice":\s*"低沉（背景补）"/);
    } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
  });

  for (const change of ["character", "costume"])
    for (const action of ["regenerate", "override"])
      test(`${action} 通过后按生成时依赖使 ${change} 图片过期`, () => {
        const snapshot = snapshotFixture(), project = snapshot.project;
        const task = taskFixture(project, "project-characters", project.basic_info.id, { action: "generate" });
        const row = name => ({ name, gender: "男", era: "宋代", position: "主角", age_range: "三十岁", body_type: "高大", hairstyle: "束发", facial_features: "", height: "", nationality: "", voice: "", signature_props: [], immutable_traits: [], costumes: [{ name: "长袍", color: "蓝色", material: "布", props: [] }] });
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
        if (action === "regenerate") {
          assert.equal(accepted.costume_images[0].address, "");
          assert.equal(accepted.costume_images[0].node_state.status, "empty");
        } else {
          assert.equal(accepted.costume_images[0].node_state.dependency_hash, imageHash);
          assert.equal(accepted.costume_images[0].node_state.status, "expired");
          assert.equal(accepted.costume_images[0].address, "甲-衣服.png");
          assert.equal(accepted.costume_images[0].node_state.dependency_hash, costumeHash);
        }
        assert.equal(untouched.id, second.id);
        assert.equal(untouched.costume_images[0].node_state.status, "generated");
        assert.equal(untouched.costume_images[0].address, "乙-衣服.png");
      });

  test("首次生成和重新提取使用同一提示词，且不提交已有角色库", async () => {
    const project = projectFixture();
    const character = emptyCharacterModel({ name: "库内独有姓名甲", gender: "男", era: "宋代" });
    project.character_library.characters = [character];
    project.script_revision.body = "剧本只写了另一人。";
    const snapshot = { project, tasks: [], steps: [] };
    const seen = [];
    const handler = createTextHandler({ chat: async ({ messages, step }) => {
      seen.push(messages.map(message => message.content).join("\n"));
      if (step.kind === "review") return { 是否通过: true, "类型": "", 原因: "" };
      return { characters: [] };
    } });
    const run = (action, kind) => handler({
      snapshot, task: taskFixture(project, "project-characters", project.basic_info.id, { action, opinion: "" }),
      step: { kind, seq: 1 }, draft: null, signal: new AbortController().signal, record: async () => {},
    });
    await run("generate", "generate");
    await run("regenerate", "generate");
    assert.equal(seen[0], seen[1]);
    assert.match(seen[0], /完整剧本/);
    assert.doesNotMatch(seen[0], /项目角色库目录|库内独有姓名甲|costume_images/);
    await run("generate", "review");
    assert.doesNotMatch(seen[2], /项目角色库目录|库内独有姓名甲|costume_images/);
  });

  test("提取仅写人物，每个人物独立生成全部服装，空服装生成一张", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-character-group-"));
    const repository = new ModelRepository(root), project = projectFixture(), model = await repository.create(project);
    const person = (name, costumes) => ({ name, gender: "男", era: "宋代", position: "主角", age_range: "成年", body_type: "健壮", hairstyle: "短发", facial_features: "", height: "", nationality: "", voice: "", signature_props: [], immutable_traits: [], costumes });
    const characters = [
      person("甲", [{ name: "常服", color: "蓝色", material: "棉", props: [] }, { name: "礼服", color: "红色", material: "丝绸", props: [] }]),
      person("乙", []),
    ];
    let extractionCalls = 0;
    const imageCalls = [];
    const text = createTextHandler({ chat: async ({ step }) => {
      if (step.kind === "review") return { 是否通过: true, "类型": "", 原因: "" };
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
        const result = await service.command({ type: "submit", project_id: project.basic_info.id, request_id: `characters-${action}`, business_type: "project-characters", target_id: project.basic_info.id, action });
        await service.idle(project.basic_info.id);
        const snapshot = model.readAll(), [first, second] = snapshot.project.character_library.characters;
        const groupId = snapshot.tasks.find(task => task.id === result.task_id).group_id;
        assert.equal(snapshot.tasks.filter(task => task.group_id === groupId).length, 1);
        const expected = [["costume-image", first.costumes[0].id], ["costume-image", first.costumes[1].id], ["costume-image", second.id]];
        const ids = expected.map(([, id]) => id);
        for (const character of [first, second]) {
          const pictures = await service.command({ type: "submit-costumes", project_id: project.basic_info.id, request_id: `${character.id}-${action}`, target_id: character.id, action });
          await service.idle(project.basic_info.id);
          const tasks = model.readAll().tasks.filter(task => task.group_id === pictures.group_id);
          assert.ok(tasks.every(task => task.task_status === "completed"), tasks.map(t => t.end_reason).join("\n"));
          assert.deepEqual(tasks.map(task => task.target_id), character.costumes.length ? character.costumes.map(costume => costume.id) : [character.id]);
        }
        Object.assign(second, model.readAll().project.character_library.characters[1]);
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
});

describe("missing-field-review", () => {
  async function scenario({ businessError = '', businessRounds = 0, badJson = false, unknownRounds = 0, unknownOnRound = 0, emptyFirst = false, missingRounds = 0, empty = false, network = false, badReview = false, business = 'shots' } = {}) {
    const home = await mkdtemp(join(tmpdir(), 'meiji-missing-review-'));
    const project = projectFixture(), episode = project.episodes[0];
    if (businessError) project.character_library.characters = [emptyCharacterModel({ name: '甲' })];
    const fields = ['title', 'id', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];
    const valid = business === 'shots' ? { shots: episode.shot_list.shots.map(shot => Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])]))) }
      : { characters: [{ name: '测试人物', gender: '女', era: '未明确', position: '主角', age_range: '', body_type: '', hairstyle: '', facial_features: '', height: '', nationality: '', voice: '', signature_props: [], immutable_traits: [], costumes: [] }] };
    if (empty) episode.shot_list.shots = [];
    let count = 0;
    const calls = [];
    const repository = new ModelRepository(home), model = await repository.create(project);
    const before = structuredClone(model.readAll().project.episodes[0].shot_list);
    const text = createTestTextHandler({ chat: async options => {
      calls.push({ kind: options.step.kind, messages: structuredClone(options.messages) });
      if (network) throw new Error('网络接口异常：响应.shots[].audio_arrangement：缺少字段');
      if (options.step.kind === 'review') return badReview ? { 是否通过: true } : { 是否通过: true, "类型": "", 原因: '' };
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
      const submitted = await service.command({ type: 'submit', project_id: project.basic_info.id, request_id: 'missing-field', business_type: business, target_id: business === 'shots' ? episode.id : project.basic_info.id, action: empty || business === 'project-characters' ? 'generate' : 'regenerate' });
      await service.idle(project.basic_info.id);
      return { snapshot: model.readAll(), taskId: submitted.task_id, calls, count, before };
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
});

describe("regenerate-mode", () => {
  for (const action of ['generate', 'regenerate', 'revise'])
    test(`${action} 明确选择首轮消息模式，自动修订只引用本轮候选`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'meiji-regenerate-mode-'));
      const repository = new ModelRepository(root), project = projectFixture();
      project.project_summary.body = '上次完整结果独有标记';
      project.project_summary.node_state.status = 'rejected';
      project.project_summary.node_state.reason = '旧审核意见';
      if (action === 'generate') {
        project.project_summary.body = '';
        project.project_summary.node_state.status = 'empty';
        project.project_summary.node_state.reason = '';
      }
      const model = await repository.create(project), requests = [];
      let reviews = 0;
      const text = createTestTextHandler({ chat: async ({ step, messages }) => {
        requests.push({ kind: step.kind, messages: structuredClone(messages) });
        if (step.kind === 'review') return { 是否通过: ++reviews > 1, "类型": (reviews > 1) ? "" : "模型问题", 原因: reviews === 1 ? '本轮修订原因' : '' };
        return step.kind === 'revise' ? '修订完成的结果' : '本轮新候选独有标记';
      } });
      const service = new TaskService({ repository, commitOutput: commitContent, execute: createHandlerRegistry({ text }) });
      try {
        const command = { type: 'submit', project_id: project.basic_info.id, business_type: 'project-summary', target_id: project.basic_info.id, action, opinion: '本次用户要求', request_id: action };
        const { task_id } = await service.command(command);
        await service.idle(project.basic_info.id);
        const snapshot = model.readAll();
        assert.equal(snapshot.tasks.find(task => task.id === task_id).task_status, 'completed');
        const first = requests[0].messages;
        assert.deepEqual(first.map(m => m.role), action === 'revise' ? ['system', 'user', 'assistant', 'user'] : ['system', 'user']);
        assert.match(first.at(-1).content, /本次用户要求/);
        if (action !== 'generate') {
          assert.match(first.at(-1).content, /旧审核意见/);
          assert.equal(first.at(-1).content.split('旧审核意见').length - 1, 1);
        }
        if (action === 'revise') {
          assert.equal(first[2].content, '上次完整结果独有标记');
          assert.doesNotMatch(first[1].content + first[3].content, /上次完整结果独有标记/);
          assert.match(snapshot.tasks.find(task => task.id === task_id).name, /原结果修订/);
        } else assert.doesNotMatch(JSON.stringify(first), /上次完整结果独有标记|# 基稿|# 待修订内容/);
        const revision = requests.find(request => request.kind === 'revise').messages;
        assert.deepEqual(revision.map(m => m.role), ['system', 'user', 'assistant', 'user']);
        assert.equal(revision[2].content, '本轮新候选独有标记');
        assert.match(revision[3].content, /本轮修订原因/);
        assert.doesNotMatch(JSON.stringify(revision), /上次完整结果独有标记/);
      } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
    });

  for (const action of ['regenerate', 'revise'])
    test(`镜头表 ${action} 实际请求不混入另一种模式`, async () => {
      const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
      episode.shot_list.shots[0].body = '旧镜头正文独有标记';
      const task = taskFixture(snapshot.project, 'shots', episode.id, { action, opinion: '本次镜头要求' });
      const fields = ['title', 'id', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];
      let sent;
      const handler = createTestTextHandler({ chat: async ({ messages }) => {
        sent = messages;
        return { shots: episode.shot_list.shots.map(shot => Object.fromEntries(fields.map(key => [key, shot[key]]))) };
      } });
      await handler({ snapshot, task, step: { kind: 'generate', seq: 2 } });
      assert.deepEqual(sent.map(m => m.role), action === 'revise' ? ['system', 'user', 'assistant', 'user'] : ['system', 'user']);
      assert.match(sent.at(-1).content, /本次镜头要求/);
      if (action === 'revise') {
        assert.match(sent[2].content, /旧镜头正文独有标记/);
        assert.doesNotMatch(sent[1].content + sent[3].content, /旧镜头正文独有标记/);
      } else assert.doesNotMatch(JSON.stringify(sent), /旧镜头正文独有标记|待修订镜头表|# 基稿/);
    });

  test('原结果修订只允许文本及非空意见，成片组不接受 revise', () => {
    const p = projectFixture(), e = p.episodes[0];
    const command = { type: 'submit', project_id: p.basic_info.id, business_type: 'outline', target_id: e.id, action: 'revise', opinion: '补足动作', request_id: 'revise' };
    assert.doesNotThrow(() => validateCommand(command));
    assert.throws(() => validateCommand({ ...command, opinion: ' ' }), /修改意见/);
    assert.throws(() => validateCommand({ ...command, business_type: 'video', target_id: e.shot_list.shots[0].id }), /仅支持文本/);
    assert.throws(() => validateCommand({ type: 'submit-group', project_id: p.basic_info.id, episode_id: e.id, group_type: 'episode-film', action: 'revise', opinion: '修改', request_id: 'group' }), /command.action/);
  });
});
