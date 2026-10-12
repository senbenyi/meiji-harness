import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture } from "./fixtures/project.js";
import { nodeOf } from "../shared/task_contract.js";
const group = (p) => ({
  type: "submit-group",
  project_id: p.id,
  request_id: "group",
  group_type: "episode-seconds",
  episode_id: p.剧集[0].id,
});
test("S4-04/05/06 组内停止作废后序，继续新组跳过有效节点，旧历史不变", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-groups-"));
  let fail = true;
  try {
    const repository = new ModelRepository(root),
      p = projectFixture(),
      model = await repository.create(p),
      service = new TaskService({
        repository,
        commitOutput: commitContent,
        execute: async ({ snapshot, task, step }) =>
          step.kind === "review"
            ? { result: { 通过: !fail, 原因: fail ? "审核失败" : "" } }
            : {
                content: {
                  衔接上一镜方式: "尾帧衔接",
                  内容: structuredClone(
                    nodeOf(snapshot.project, "seconds", task.target_id).内容,
                  ),
                },
              },
      });
    const result = await service.command(group(p));
    await service.idle(p.id);
    const before = model.read();
    assert.equal(before.tasks[0].task_status, "rejected");
    assert.equal(before.tasks[1].task_status, "superseded");
    assert.equal(
      before.project.剧集[0].镜头表.镜头[1].每秒分镜.状态,
      "generated",
    );
    fail = false;
    const next = await service.command({
      type: "continue-group",
      project_id: p.id,
      request_id: "continue",
      group_id: result.group_id,
    });
    assert.notEqual(next.group_id, result.group_id);
    assert.equal(next.task_ids.length, 1);
    const task = next.task_ids[0];
    assert.equal(
      model.read().tasks.find((t) => t.id === task).action,
      "continue",
    );
    // 队列失败后继续创建新组，仍须显式从面板开始。
    await service.command({
      type: "start-queued",
      project_id: p.id,
      request_id: "start-new-group",
      task_id: task,
    });
    await service.idle(p.id);
    assert.deepEqual(model.read().tasks.slice(0, 2), before.tasks);
    assert.deepEqual(model.read().groups[0], before.groups[0]);
    assert.equal(model.read().tasks[2].task_status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("S4-10 重叠整组拒绝，幂等返回原组，无部分状态写入", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-conflict-"));
  let release;
  const gate = new Promise((r) => (release = r));
  try {
    const repository = new ModelRepository(root),
      p = projectFixture(),
      model = await repository.create(p),
      service = new TaskService({
        repository,
        commitOutput: commitContent,
        execute: async () => {
          await gate;
          throw new Error("测试停止");
        },
      });
    const first = await service.command(group(p));
    const same = await service.command(group(p));
    assert.equal(first.group_id, same.group_id);
    const before = model.read().groups.length;
    await assert.rejects(
      service.command({ ...group(p), request_id: "other" }),
      { code: "TASK_CONFLICT" },
    );
    assert.equal(model.read().groups.length, before);
    assert.equal(model.read().tasks.length, 2);
    release();
    await service.idle(p.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S4-11 继续组重做上游时，将即将过期的已生成视频/尾帧一并纳入", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-prospective-"));
  let service;
  try {
    const p = projectFixture();
    p.剧集[0].镜头表.镜头 = p.剧集[0].镜头表.镜头.slice(0, 1);
    p.剧集[0].时长秒 = 5;
    p.剧集[0].故事大纲.小段[0].时长秒 = 5;
    const repository = new ModelRepository(root),
      model = await repository.create(p);
    service = new TaskService({
      repository,
      commitOutput: commitContent,
      execute: async () => {
        throw Error("模拟上游失败");
      },
    });
    const first = await service.command({
      type: "submit-group",
      project_id: p.id,
      request_id: "first",
      group_type: "episode-film",
      episode_id: p.剧集[0].id,
    });
    await service.idle(p.id);
    assert.equal(
      model.read().project.剧集[0].镜头表.镜头[0].视频.状态,
      "generated",
    );
    const next = await service.command({
      type: "continue-group",
      project_id: p.id,
      request_id: "continue",
      group_id: first.group_id,
    });
    assert.deepEqual(
      model
        .read()
        .tasks.filter((t) => next.task_ids.includes(t.id))
        .map((t) => t.business_type),
      ["seconds", "storyboard", "video", "tail"],
    );
  } finally {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
