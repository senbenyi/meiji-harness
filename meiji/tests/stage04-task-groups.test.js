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
import { stampDependencyHash } from "../shared/node-dependencies.js";
const group = (p) => ({
  type: "submit-group",
  project_id: p.id,
  request_id: "group",
  group_type: "episode-seconds",
  action: "regenerate",
  episode_id: p.episodes[0].id,
});
test("S4-04/05/06 组内停止作废后序，继续新组从停点接续，旧历史不变", async () => {
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
            ? { result: { 是否通过: !fail, 原因: fail ? "审核失败" : "" } }
            : {
                content: {
                  storyboard: structuredClone(
                    nodeOf(snapshot.project, "seconds", task.target_id).storyboard,
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
      before.project.episodes[0].shot_list.shots[1].seconds_storyboard.node_state.status,
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
    assert.equal(next.task_ids.length, 2);
    const task = next.task_ids[0];
    assert.equal(
      model.read().tasks.find((t) => t.id === task).action,
      "regenerate",
    );
    // 面板继续直接执行新组，无需再次点击开始。
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
    p.episodes[0].shot_list.shots = p.episodes[0].shot_list.shots.slice(0, 1);
    p.episodes[0].duration_seconds = 5;
    p.episodes[0].story_outline.segments[0].duration_seconds = 5;
    const snapshot = { project: p, tasks: [], steps: [] };
    for (const business of ["outline", "shots"])
      stampDependencyHash(snapshot, business, p.episodes[0].id);
    for (const business of ["seconds", "storyboard", "video", "tail"])
      stampDependencyHash(snapshot, business, p.episodes[0].shot_list.shots[0].id);
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
      action: "regenerate",
      episode_id: p.episodes[0].id,
    });
    await service.idle(p.id);
    assert.equal(model.read().tasks[0].end_reason, "模拟上游失败");
    assert.equal(
      model.read().project.episodes[0].shot_list.shots[0].video.node_state.status,
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

test("继续只给停点任务带拒绝原因，组不保存意见或来源组", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-continue-reason-"));
  let service;
  try {
    const repository = new ModelRepository(root), p = projectFixture(), model = await repository.create(p);
    service = new TaskService({ repository, commitOutput: commitContent, execute: async ({ snapshot, task, step }) =>
      step.kind === "review" ? { result: { 是否通过: false, 原因: "停点审核拒绝" } }
        : { content: { storyboard: structuredClone(nodeOf(snapshot.project, "seconds", task.target_id).storyboard) } } });
    const first = await service.command({ ...group(p), opinion: "旧组意见" });
    await service.idle(p.id);
    const before = model.read();
    const continued = await service.command({ type: "continue-group", project_id: p.id, request_id: "resume", group_id: first.group_id });
    const current = model.read(), tasks = current.tasks.filter(t => t.group_id === continued.group_id), nextGroup = current.groups.find(g => g.id === continued.group_id);
    assert.equal(tasks[0].opinion, "停点审核拒绝");
    assert.equal(tasks[1].opinion, "");
    assert.deepEqual(tasks.map(t => t.group_seq), [1,2]);
    assert.equal("opinion" in nextGroup, false);
    assert.equal("continued_from_group_id" in nextGroup, false);
    assert.deepEqual(current.tasks.slice(0,2), before.tasks);
  } finally { await service?.dispose(); await rm(root, { recursive: true, force: true }); }
});
