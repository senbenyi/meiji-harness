import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NODE_DEFINITIONS, OPERATION_DEFINITIONS, TEXT_BUSINESSES } from "../shared/node-definitions.js";
import { createId, nodeOf } from "../shared/task-contract.js";
import { stepKinds } from "../shared/task-plan.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";

test("统一节点目录与示例结构一致，定位、审核和前置规则均由目录描述", async () => {
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
  const spec = JSON.parse(await readFile(new URL("../dev_docs/step_model.json", import.meta.url), "utf8"));
  const specByType = new Map(spec.node_type.map((row) => [row.值, row]));
  assert.deepEqual(Object.keys(NODE_DEFINITIONS).sort(), [...specByType.keys()].sort());
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
    const row = specByType.get(business);
    assert.equal(row["目标类型"], definition.targetKind);
    assert.equal(row["字段"], definition.field);
    assert.equal(row["处理器"], definition.handler);
    assert.equal(row["产物"], definition.output);
    assert.equal(row["需要AI审核"], definition.review);
    assert.equal(row["前置检查规则"], definition.precheck);
  }
  for (const [business, definition] of Object.entries(OPERATION_DEFINITIONS)) {
    assert.equal(nodeOf(project, business, targetByKind[definition.targetKind]), null);
    assert.equal(stepKinds(taskFixture(project, business, targetByKind[definition.targetKind])).includes("review"), definition.review);
  }
});
