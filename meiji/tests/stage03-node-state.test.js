import test from "node:test";
import assert from "node:assert/strict";
import {
  setNodeState,
  enqueueNode,
  restoreQueued,
  assertOutput,
  assertProgramReview,
} from "../shared/node-state.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";

test("首套定妆照只需任一人物资料字段，全部空白或仅有管理字段仍拒绝", () => {
  const fields = ["name", "position", "age_range", "body_type", "hairstyle", "signature_props", "immutable_traits"];
  const project = projectFixture();
  const character = emptyCharacterModel({ number: "C01", required_appearance: true });
  project.character_library.characters = [character];
  const task = { business_type: "costume-image", target_id: character.id, action: "generate" };
  for (const field of fields) {
    Object.assign(character, Object.fromEntries(fields.map((key) => [key, ["signature_props", "immutable_traits"].includes(key) ? [" \n "] : " \n "])));
    character[field] = ["signature_props", "immutable_traits"].includes(field) ? [" 有资料 "] : " 有资料 ";
    assert.equal(precheck({ project }, task).passed, true, field);
  }
  for (const field of fields) character[field] = ["signature_props", "immutable_traits"].includes(field) ? [] : " \n ";
  character.reference_image.address = "reference.png";
  assert.throws(() => precheck({ project }, task), /至少填写一项人物资料/);
  character.name = "甲";
  assert.throws(() => precheck({ project }, { ...task, action: "regenerate" }), /未生成节点/);
  character.costume_images[0].address = "existing.png";
  assert.throws(() => precheck({ project }, task), /已有内容/);
  assert.equal(precheck({ project }, { ...task, action: "regenerate" }).passed, true);
  project.character_library.characters = [];
  assert.throws(() => precheck({ project }, task), /不存在/);
});

test("S3-01/02 状态和原因一起转换，未开始取消恢复快照，非法转换拒绝", () => {
  const p = projectFixture(),
    t = taskFixture(p),
    node = p.episodes[0].shot_list.shots[0].seconds_storyboard;
  enqueueNode(p, t);
  assert.equal(node.node_state.status, "generated");
  assert.deepEqual(t.previous_node_state, { status: "generated", reason: "" });
  restoreQueued(p, t);
  assert.equal(node.node_state.status, "generated");
  assert.equal(node.storyboard[0].action, "动作");
  assert.throws(() => setNodeState(node, "failed", "原因"), /非法转换/);
  enqueueNode(p, t);
  setNodeState(node, "running");
  setNodeState(node, "cancelled", "用户取消");
  assert.equal(node.node_state.reason, "用户取消");
  assert.equal(node.storyboard[0].action, "动作");
  assert.throws(() => setNodeState(node, "queued", "多余原因"), /非法转换/);
});

test("大纲结构允许有限正数，程序审核按参考时长±30；镜头仍为4–15整数秒", () => {
  const project = projectFixture(), episode = project.episodes[0];
  episode.duration_seconds = 150;
  for (const duration of [120, 150, 180, 137.5]) {
    episode.story_outline.segments[0].duration_seconds = duration;
    assert.doesNotThrow(() => assertProgramReview(project, "outline", episode.id));
  }
  for (const duration of [119, 181]) {
    episode.story_outline.segments[0].duration_seconds = duration;
    assert.doesNotThrow(() => assertOutput(project, "outline", episode.id));
    assert.throws(() => assertProgramReview(project, "outline", episode.id), /允许误差±30秒/);
  }
  for (const duration of [0, -1, NaN, Infinity]) {
    episode.story_outline.segments[0].duration_seconds = duration;
    assert.throws(() => assertOutput(project, "outline", episode.id), /有限正数/);
  }
  episode.story_outline.segments[0].duration_seconds = 150;
  episode.duration_seconds = 10;
  for (const duration of [4, 15]) {
    episode.shot_list.shots[0].duration_seconds = duration;
    assert.doesNotThrow(() => assertProgramReview(project, "shots", episode.id));
  }
  for (const duration of [3, 16]) {
    episode.shot_list.shots[0].duration_seconds = duration;
    assert.doesNotThrow(() => assertOutput(project, "shots", episode.id));
    assert.throws(() => assertProgramReview(project, "shots", episode.id), /4–15/);
  }
  episode.shot_list.shots[0].duration_seconds = 4.5;
  assert.throws(() => assertOutput(project, "shots", episode.id), /正整数/);
});
test("S3-06 前置检查重新读取当前输入，generated 但内容无效也失败", () => {
  const p = projectFixture(),
    t = taskFixture(p, "storyboard");
  assert.equal(precheck({ project: p }, t).passed, true);
  p.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.status = "expired";
  p.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.reason = "过期";
  assert.throws(() => precheck({ project: p }, t), /尚未有效生成/);
  p.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.status = "generated";
  p.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.reason = "";
  p.episodes[0].shot_list.shots[0].seconds_storyboard.storyboard = [];
  assert.throws(() => assertOutput(p, "seconds", t.target_id), /为空/);
});
