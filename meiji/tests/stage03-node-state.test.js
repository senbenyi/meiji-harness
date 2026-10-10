import test from "node:test";
import assert from "node:assert/strict";
import {
  setNodeState,
  enqueueNode,
  restoreQueued,
  assertOutput,
} from "../shared/node-state.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";

test("S3-01/02 状态和原因一起转换，未开始取消恢复快照，非法转换拒绝", () => {
  const p = projectFixture(),
    t = taskFixture(p),
    node = p.剧集[0].镜头表.镜头[0].每秒分镜;
  enqueueNode(p, t);
  assert.equal(node.状态, "queued");
  restoreQueued(p, t);
  assert.equal(node.状态, "generated");
  assert.equal(node.内容.事件, "事件");
  assert.throws(() => setNodeState(node, "failed", "原因"), /非法转换/);
  enqueueNode(p, t);
  setNodeState(node, "running");
  setNodeState(node, "cancelled", "用户取消");
  assert.equal(node.原因, "用户取消");
  assert.equal(node.内容.事件, "事件");
  assert.throws(() => setNodeState(node, "queued", "多余原因"), /不一致/);
});
test("S3-06 前置检查重新读取当前输入，generated 但内容无效也失败", () => {
  const p = projectFixture(),
    t = taskFixture(p, "storyboard");
  assert.equal(precheck({ project: p }, t).passed, true);
  p.剧集[0].镜头表.镜头[0].每秒分镜.状态 = "expired";
  p.剧集[0].镜头表.镜头[0].每秒分镜.原因 = "过期";
  assert.throws(() => precheck({ project: p }, t), /尚未有效生成/);
  p.剧集[0].镜头表.镜头[0].每秒分镜.状态 = "generated";
  p.剧集[0].镜头表.镜头[0].每秒分镜.原因 = "";
  p.剧集[0].镜头表.镜头[0].每秒分镜.内容.节拍 = [];
  assert.throws(() => assertOutput(p, "seconds", t.target_id), /覆盖/);
});
