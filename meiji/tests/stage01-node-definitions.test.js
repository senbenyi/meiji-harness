import test from "node:test";
import assert from "node:assert/strict";
import { NODE_DEFINITIONS, OPERATION_DEFINITIONS, TEXT_BUSINESSES } from "../shared/node-definitions.js";
import { createId, nodeOf } from "../shared/task_contract.js";
import { stepKinds } from "../shared/task-plan.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";

test("统一节点目录描述定位和审核规则", async () => {
  const project = projectFixture();
  const character = {
    id: createId("character"), 图片: { 状态: "empty", 原因: "", 地址: "" },
    服装: [{ id: createId("costume"), 图片: { 状态: "empty", 原因: "", 地址: "" } }],
  };
  project.角色库.角色 = [character];
  const targetByKind = {
    project: project.id,
    character: character.id,
    costume: character.服装[0].id,
    episode: project.剧集[0].id,
    shot: project.剧集[0].镜头表.镜头[0].id,
  };
  for (const [business, definition] of Object.entries(NODE_DEFINITIONS)) {
    const node = nodeOf(project, business, targetByKind[definition.targetKind]);
    const targetObject = {
      project,
      character,
      costume: character.服装[0],
      episode: project.剧集[0],
      shot: project.剧集[0].镜头表.镜头[0],
    }[definition.targetKind];
    assert.equal(node, targetObject[definition.field]);
    assert.equal(TEXT_BUSINESSES.includes(business), definition.handler === "text");
    assert.equal(stepKinds(taskFixture(project, business, targetByKind[definition.targetKind])).includes("review"), definition.review);
  }
  for (const [business, definition] of Object.entries(OPERATION_DEFINITIONS)) {
    assert.equal(nodeOf(project, business, targetByKind[definition.targetKind]), null);
    assert.equal(stepKinds(taskFixture(project, business, targetByKind[definition.targetKind])).includes("review"), definition.review);
  }
});
