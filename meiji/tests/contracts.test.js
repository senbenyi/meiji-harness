import test, { describe } from "node:test";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { emptyCostumeModel } from "../shared/models/costume_model.js";
import { emptyCostumeImageModel } from "../shared/models/costume_image_model.js";
import assert from "node:assert/strict";
import { createId, NODE_STATUS, TASK_STATUS, STEP_STATUS, BUSINESS_TARGET, validateTask, validateStep, validateCommand, nodeOf } from "../shared/task_contract.js";
import { emptyProject, emptyEpisode, emptyShot, validateProject } from "../shared/project_contract.js";
import { composeNodePrompt, nodeAction } from "../server/http/ai-routes.js";
import { deliverTaskNotice } from "../server/host/task-notices.js";
import { emptyProjectModel } from "../shared/models/project_model.js";
import { emptyEpisodeModel } from "../shared/models/episode_model.js";
import { emptyShotModel } from "../shared/models/shot_model.js";
import { emptyStorySegmentModel } from "../shared/models/story_segment_model.js";
import { emptyOnScreenCharacterModel } from "../shared/models/on_screen_character_model.js";
import { emptyStoryboardBeatModel } from "../shared/models/storyboard_beat_model.js";
import { emptyDialogueModel } from "../shared/models/dialogue_model.js";
import { emptyReferenceImageModel } from "../shared/models/reference_image_model.js";
import { createTaskGroupModel } from "../shared/models/task_group_model.js";
import { createTaskModel } from "../shared/models/task_model.js";
import { createStepModel } from "../shared/models/step_model.js";
import { emptySceneModel } from "../shared/models/scene_model.js";
import { NODE_DEFINITIONS, OPERATION_DEFINITIONS, TEXT_BUSINESSES } from "../shared/node-definitions.js";
import { stepKinds, reviewTypes } from "../shared/task-plan.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";

describe("contracts", () => {
  const projectFixture = () => {
    const p = emptyProject({ name: "新项目", creation_mode: "自由创作", creative_direction: "测试故事" });
    const c = emptyCharacterModel({ name: "甲", required_appearance: true });
    const co = emptyCostumeModel({ name: "常服", description: "常服" });
    c.costume_images = [emptyCostumeImageModel(co.id)];
    c.costumes = [co];
    c.default_costume_id = co.id;
    p.character_library.characters = [c];
    const e = emptyEpisode({ sequence: 1 });
    const s = emptyShot({ sequence: 1, number: "S01" });
    s.on_screen_characters = [{ character_id: c.id, costume_id: co.id }];
    e.shot_list.shots = [s];
    p.episodes = [e];
    return p;
  };
  const taskFixture = (p) => ({
    id: createId("task"),
    project_id: p.id,
    episode_id: p.episodes[0].id,
    business_type: "seconds",
    target_id: p.episodes[0].shot_list.shots[0].id,
    action: "generate",
    group_id: null,
    group_seq: null,
    task_status: "queued",
    source: "panel",
    queue_order: 1,
    end_reason: "",
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    opinion: "",
    previous_node_state: { status: "empty", reason: "" },
  });

  test("新项目结构、四种数据状态及原因约束", () => {
    const p = projectFixture();
    assert.equal(validateProject(p), p);
    for (const status of NODE_STATUS) {
      const q = structuredClone(p);
      q.project_summary.node_state.status = status;
      q.project_summary.node_state.reason = ["rejected", "cancelled", "expired"].includes(status) ? "原因" : "";
      q.project_summary.node_state.fail_message = status === "failed" ? "失败说明" : "";
      assert.equal(validateProject(q), q);
    }
    const bad = structuredClone(p);
    bad.output_language = "en";
    assert.throws(() => validateProject(bad), /output_language/);
    p.project_summary.node_state.status = "passed";
    assert.throws(() => validateProject(p), /status/);
  });
  test("本集资产不再属于项目结构或可提交任务业务", () => {
    const p = projectFixture(),
      e = p.episodes[0];
    assert.equal(Object.hasOwn(e, "本集资产"), false);
    assert.equal(Object.hasOwn(BUSINESS_TARGET, "episode-characters"), false);
    const invalid = structuredClone(p);
    invalid.episodes[0].本集资产 = { 状态: "empty", 原因: "", 角色: [] };
    assert.throws(() => validateProject(invalid), /本集资产/);
    assert.throws(() => validateCommand({
      type: "submit", project_id: p.id, request_id: "removed",
      business_type: "episode-characters", target_id: e.id, action: "generate",
    }), /business_type/);
  });
  test("ID 一次生成，编号排序与 ID 独立", () => {
    const p = projectFixture();
    const before = p.episodes[0].shot_list.shots[0].id;
    p.episodes[0].shot_list.shots[0].number = "S02";
    validateProject(p);
    assert.equal(p.episodes[0].shot_list.shots[0].id, before);
    for (const kind of [
      "project",
      "episode",
      "character",
      "costume",
      "shot",
      "rule",
      "task",
      "group",
      "step",
    ])
      assert.match(createId(kind), /^[a-z]+_[0-9a-f-]{36}$/);
    assert.throws(() => createId("unknown"), /类型/);
  });
  test("角色与服装只保留ID，禁止第二套编号", () => {
    const p = projectFixture();
    const character = p.character_library.characters[0], costume = character.costumes[0];
    assert.equal(Object.hasOwn(character, 'number'), false);
    assert.equal(Object.hasOwn(costume, 'number'), false);
    assert.equal(validateProject(p), p);
    character.number = 'C01';
    assert.throws(() => validateProject(p), /number/);
  });
  test("任务目标归属和字段协议严格校验，剧本无状态", () => {
    const p = projectFixture(),
      t = taskFixture(p);
    assert.equal(validateTask(t, p), t);
    assert.throws(() => validateTask({ ...t, target_id: p.id }, p), /目标/);
    assert.throws(
      () => validateTask({ ...t, episode_id: createId("episode") }, p),
      /剧集/,
    );
    assert.throws(
      () => validateTask({ ...t, requirements: "旧字段" }, p),
      /requirements/,
    );
    assert.throws(
      () => validateCommand({ type: "resume", project_id: p.id }),
      /命令/,
    );
    assert.throws(
      () =>
        validateCommand({
          type: "submit",
          project_id: p.id,
          business_type: "seconds",
          target_id: t.target_id,
          action: "continue",
          request_id: "request-1",
        }),
      /组合/,
    );
    assert.equal(validateProject(p), p);
    assert.ok(!("状态" in p.script));
    const st = {
      id: createId("step"),
      task_id: t.id,
      seq: 1,
      kind: "precheck",
      round: 0,
      step_status: "ready",
      executor: "program",
      error_reason: "",
      prompt: null,
      http: [],
      result: null,
      started_at: null,
      ended_at: null,
    };
    validateStep(st, t);
    for (const [field, value] of [["executor", "人工"], ["http", null], ["prompt", []]])
      assert.throws(() => validateStep({ ...st, [field]: value }, t), new RegExp(`step\\.${field}`));
    assert.deepEqual(NODE_STATUS, ["empty", "generated", "rejected", "expired"]);
    assert.deepEqual(TASK_STATUS, [
      "queued",
      "running",
      "completed",
      "rejected",
      "failed",
      "cancelled",
      "superseded",
    ]);
    assert.deepEqual(STEP_STATUS, [
      "ready",
      "running",
      "done",
      "rejected",
      "failed",
      "skipped",
      "cancelled",
      "superseded",
    ]);
    assert.equal(BUSINESS_TARGET["costume-delete"], "costume");
  });
  test('用户资料中的占位符不二次展开，未定义路由不加载任何文件', () => {
    const rendered = composeNodePrompt('project-summary', 'generate', { script: '原样资料{{不是模板}}', language: 'zh-CN', requirements: '' }, 'qwen3.5:27b');
    assert.ok(rendered.user.includes('{{不是模板}}'));
    assert.throws(() => nodeAction('../step_model', 'generate'), /不存在/);
  });
  test("通知预检：只在会话显示提示卡，不唤醒 AI、不进入模型上下文", async () => {
    const events = [];
    let sent = 0;
    const controller = {
      async resolveAgent(id) {
        assert.equal(id, "session-test");
        return {
          agent: {
            send() {
              sent += 1;
            },
            session: {
              append(type, data) {
                events.push([type, data]);
              },
            },
          },
        };
      },
    };
    const notice = {
      id: "notice-1",
      session_id: "session-test",
      project_id: createId("project"),
      task_id: createId("task"),
      event: "failed",
      status: "failed",
      reason: "剧情未生成",
    };
    await deliverTaskNotice(controller, notice);
    assert.equal(sent, 0);
    assert.deepEqual(
      events.map(([type]) => type),
      ["command/run", "command/done"],
    );
    assert.equal(events[0][1].commandId, "notice-1");
    assert.equal(events[1][1].commandId, "notice-1");
    assert.equal(events[1][1].kind, "error");
    assert.ok(events[1][1].text.includes("失败"));
    assert.ok(events[1][1].text.includes("剧情未生成"));
    await assert.rejects(
      deliverTaskNotice(
        {
          async resolveAgent() {
            return { agent: null };
          },
        },
        notice,
      ),
      /会话/,
    );
  });

  test("所有命令共享严格白名单，组/人工/删除/队列协议完整", () => {
    const p = projectFixture(),
      taskId = createId("task"),
      groupId = createId("group");
    const base = { project_id: p.id, request_id: "request-1" };
    for (const data of [
      {
        type: "submit-group",
        group_type: "episode-film",
        episode_id: p.episodes[0].id,
      },
      { type: "cancel", task_id: taskId },
      { type: "continue-group", group_id: groupId },
      {
        type: "manual-edit",
        business_type: "project-summary",
        target_id: p.id,
        content: { 正文: "手动" },
      },
      { type: "override", business_type: "project-summary", target_id: p.id },
      {
        type: "delete",
        business_type: "character-delete",
        target_id: p.character_library.characters[0].id,
      },
    ])
      assert.equal(validateCommand({ ...base, ...data }).type, data.type);
    assert.equal(
      validateCommand({ type: "query", project_id: p.id }).type,
      "query",
    );
    assert.throws(
      () =>
        validateCommand({
          ...base,
          type: "submit-group",
          group_type: "unknown",
          episode_id: p.episodes[0].id,
        }),
      /group_type/,
    );
    assert.throws(() => validateCommand({ ...base, type: "cancel" }), /task_id/);
    assert.throws(
      () =>
        validateCommand({
          ...base,
          type: "cancel",
          task_id: taskId,
          resume: true,
        }),
      /resume/,
    );
    assert.throws(
      () =>
        validateCommand({
          ...base,
          type: "delete",
          business_type: "video",
          target_id: p.id,
        }),
      /删除/,
    );
  });

  test('输出格式只在 system，空资料段省略且请求不能覆盖输出格式', () => {
    const input = { script: '', language: 'zh-CN', requirements: '' };
    const prompt = composeNodePrompt('project-summary', 'generate', input, 'qwen3.5:27b');
    assert.ok(!prompt.user.includes('背景信息'));
    assert.ok(!prompt.user.includes('输出格式'));
    assert.match(prompt.system, /输出格式/);
    assert.throws(() => composeNodePrompt('project-summary', 'generate', { ...input, output: {} }, 'qwen3.5:27b'), /未定义参数/);
  });
});

describe("models", () => {
  test("项目模型的每个嵌套数组项都由独立模型构造并通过完整结构校验", () => {
    const project = emptyProjectModel();
    const character = emptyCharacterModel({ name: "角色" });
    const costume = emptyCostumeModel({ name: "常服" });
    character.costumes.push(costume);
    character.default_costume_id = costume.id;
    character.costume_images.push(emptyCostumeImageModel(costume.id));
    project.character_library.characters.push(character);

    const episode = emptyEpisodeModel();
    episode.story_outline.segments.push(emptyStorySegmentModel());
    const shot = emptyShotModel();
    shot.on_screen_characters.push(emptyOnScreenCharacterModel({ character_id: character.id, costume_id: costume.id }));
    const beat = emptyStoryboardBeatModel();
    beat.time_range = "0–1s";
    beat.dialogue.push(emptyDialogueModel());
    shot.seconds_storyboard.storyboard.push(beat);
    shot.multimodal_prompt.reference_images.push(emptyReferenceImageModel());
    episode.shot_list.shots.push(shot);
    project.episodes.push(episode);

    assert.equal(validateProject(project), project);
  });

  test("任务组、任务和步骤固定字段模型均为英文 snake_case", () => {
    const group = createTaskGroupModel();
    const task = createTaskModel();
    const step = createStepModel();
    assert.deepEqual(Object.keys(group), ["id", "project_id", "episode_id", "name", "group_type", "action", "source", "shot_ids", "created_at"]);
    assert.deepEqual(Object.keys(task), ["id", "project_id", "episode_id", "business_type", "target_id", "action", "group_id", "group_seq", "task_status", "source", "name", "queue_order", "end_reason", "created_at", "started_at", "ended_at", "opinion", "previous_node_state"]);
    assert.deepEqual(Object.keys(step), ["id", "task_id", "name", "seq", "kind", "round", "step_status", "executor", "error_reason", "prompt", "http", "result", "started_at", "ended_at"]);
  });
});

describe("node-definitions", () => {
  test("统一节点目录描述定位和审核规则", async () => {
    const project = projectFixture();
    const costume = emptyCostumeModel();
    const character = emptyCharacterModel({ costumes: [costume], costume_images: [emptyCostumeImageModel(costume.id)] });
    project.character_library.characters = [character];
    const scene = emptySceneModel(); project.scene_library.scenes = [scene];
    const targetByKind = {
      scene: scene.id,
      project: project.id,
      character: character.id,
      costume: character.costumes[0].id,
      episode: project.episodes[0].id,
      shot: project.episodes[0].shot_list.shots[0].id,
    };
    for (const [business, definition] of Object.entries(NODE_DEFINITIONS)) {
      const node = nodeOf(project, business, targetByKind[definition.targetKind]);
      const targetObject = {
        scene,
        project,
        character,
        costume: character.costumes[0],
        episode: project.episodes[0],
        shot: project.episodes[0].shot_list.shots[0],
      }[definition.targetKind];
      assert.equal(node, ["costume-image", "character-image"].includes(business) ? character.costume_images[0] : targetObject[definition.field]);
      assert.equal(TEXT_BUSINESSES.includes(business), definition.handler === "text");
      assert.equal(stepKinds(taskFixture(project, business, targetByKind[definition.targetKind])).includes("review"), (definition.programReview || definition.aiReview));
    }
    for (const [business, definition] of Object.entries(OPERATION_DEFINITIONS)) {
      assert.equal(nodeOf(project, business, targetByKind[definition.targetKind]), null);
      assert.equal(stepKinds(taskFixture(project, business, targetByKind[definition.targetKind])).includes("review"), (definition.programReview || definition.aiReview));
    }
  });

  test("剧集摘要仅AI审核，大纲和镜头表依次程序及AI审核，共用两次修订", () => {
    for (const business of ["episode-summary", "outline", "shots"]) {
      assert.deepEqual(reviewTypes({ business_type: business }), business === "episode-summary" ? ["ai"] : ["program", "ai"]);
      assert.equal(NODE_DEFINITIONS[business].retryRounds, 2);
    }
  });
});
