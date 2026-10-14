import test from "node:test";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { emptyCostumeModel } from "../shared/models/costume_model.js";
import { emptyCostumeImageModel } from "../shared/models/costume_image_model.js";
import assert from "node:assert/strict";
import {
  createId,
  NODE_STATUS,
  TASK_STATUS,
  STEP_STATUS,
  BUSINESS_TARGET,
  validateTask,
  validateStep,
  validateCommand,
  projectNumberCatalog,
  translateNumbers,
} from "../shared/task_contract.js";
import {
  emptyProject,
  emptyEpisode,
  emptyShot,
  validateProject,
} from "../shared/project_contract.js";
import { nodeRoutes, composeNodePrompt, nodeAction } from '../server/http/ai-routes.js';
import { sampleInput } from './fixtures/ai.js';

import { deliverTaskNotice } from "../server/host/task-notices.js";

const projectFixture = () => {
  const p = emptyProject({ name: "新项目", creation_mode: "自由创作", creative_direction: "测试故事" });
  const c = emptyCharacterModel({ number: "C01", name: "甲", required_appearance: true });
  const co = emptyCostumeModel({ number: "C01-01", name: "常服", description: "常服" });
  c.costume_images = [emptyCostumeImageModel(co.id)];
  c.costumes = [co];
  c.default_costume_id = co.id;
  p.character_library.characters = [c];
  const e = emptyEpisode({ sequence: 1 });
  const s = emptyShot({ sequence: 1, number: "S01" });
  s.character_binding.on_screen_characters = [{ character_id: c.id, costume_id: co.id }];
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

test("S1-01 新项目结构、七种状态及原因约束", () => {
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
test("S1-02 ID 一次生成，编号排序与 ID 独立", () => {
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
test("S1-03 AI 资料与编号引用不泄漏内部 ID，未知与重复编号失败", () => {
  const p = projectFixture(),
    catalog = projectNumberCatalog(p, p.episodes[0].id);
  const source = JSON.stringify(catalog);
  assert.ok(!source.includes(p.id));
  assert.ok(!source.includes(p.character_library.characters[0].id));
  const value = translateNumbers(
    {
      角色编号: "C01",
      服装编号: "C01-01",
      对白: [{ 说话人编号: "C01", 台词: "你好" }],
    },
    p,
    p.episodes[0].id,
  );
  assert.equal(value.character_id, p.character_library.characters[0].id);
  assert.equal(value.对白[0].speaker_id, p.character_library.characters[0].id);
  assert.throws(() => translateNumbers({ 角色编号: "C99" }, p), /未知/);
  assert.throws(() => translateNumbers({ 角色编号: "C01-01" }, p), /类型/);
  assert.equal(catalog.characters[0].默认服装编号, "C01-01");
  assert.equal(catalog.shots[0].character_binding.on_screen_characters[0].角色编号, "C01");
  p.character_library.characters.push({ ...p.character_library.characters[0], id: createId("character") });
  assert.throws(() => projectNumberCatalog(p), /重复/);
});
test("S1-04 任务目标归属和字段协议严格校验，剧本无状态", () => {
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
    error_reason: "",
    prompt: null,
    result: null,
    started_at: null,
    ended_at: null,
  };
  validateStep(st, t);
  assert.deepEqual(NODE_STATUS, [
    "empty",
    "running",
    "generated",
    "rejected",
    "failed",
    "cancelled",
    "expired",
  ]);
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
for (const [node, route] of Object.entries(nodeRoutes)) {
  for (const [action, contract] of Object.entries(route.actions)) test(`S1-05 ${node}/${action} 路由参数填充节点提示词`, () => {
    const input = sampleInput(contract.input);
    const rendered = composeNodePrompt(node, action, input, 'qwen3.5:27b');
    if (node !== 'video') assert.ok(rendered.system);
    else assert.equal(rendered.system, '');
    assert.ok(rendered.user);
    assert.deepEqual(rendered.output, contract.output);
    assert.throws(() => composeNodePrompt(node, action, {}, 'qwen3.5:27b'), /输入/);
    if (node === 'video') assert.equal(Object.hasOwn(route, 'promptModel'), false);
    else assert.ok(!Object.hasOwn(route.promptModel[action].system, '输出格式'));
  });
}
test('S1-05 用户资料中的占位符不二次展开，未定义路由不加载任何文件', () => {
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

test("S1-04 所有命令共享严格白名单，组/人工/删除/队列协议完整", () => {
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
    { type: "start-queued", task_id: taskId },
    { type: "remove-queued", task_id: taskId },
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

test('S1-05 输出格式只在 system，空资料段省略且请求不能覆盖输出格式', () => {
  const input = { script: '', language: 'zh-CN', requirements: '' };
  const prompt = composeNodePrompt('project-summary', 'generate', input, 'qwen3.5:27b');
  assert.ok(!prompt.user.includes('背景信息'));
  assert.ok(!prompt.user.includes('输出格式'));
  assert.match(prompt.system, /输出格式/);
  assert.throws(() => composeNodePrompt('project-summary', 'generate', { ...input, output: {} }, 'qwen3.5:27b'), /未定义参数/);
});
