import { seedQueuedTasks } from './fixtures/queued-tasks.js';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";
import { newStep } from "../shared/task-plan.js";
import { createAppRuntime } from "../server/runtime/app-runtime.js";

test("S8-01 旧格式明确拒绝，不读取正文或迁移；仅显式删除清理旧文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-legacy-")),
    id = randomUUID();
  try {
    await writeFile(
      join(root, id + ".json"),
      "这不是可读的 JSON，加载不得读取",
    );
    await mkdir(join(root, id));
    const repo = new ModelRepository(root);
    await assert.rejects(repo.open(id), { code: "UNSUPPORTED_PROJECT" });
    assert.equal((await repo.list())[0].unsupported, true);
    await repo.removeUnsupported(id);
    assert.deepEqual(await repo.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("重启仅排队组合：全组取消并保留统一原因，节点和媒体恢复，不自动执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-restart-group-"));
  try {
    const repository = new ModelRepository(root), p = projectFixture(), model = await repository.create(p);
    await model.update("pause", {}, s => { s.project.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.status = "expired"; s.project.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.reason = "之前过期"; });
    const beforeProject = model.read().project;
    let executed = 0;
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async () => { executed++; throw new Error("旧组合不应执行"); } });
    await seedQueuedTasks(model, p.episodes[0].shot_list.shots.flatMap(shot => ['seconds','storyboard','video'].map(b => [b,shot.id])));
    assert.equal(model.read().tasks.length, 6);
    const restored = await new ModelRepository(root).open(p.id);
    await service.recover(restored);
    const s = restored.read();
    assert.ok(s.tasks.every(t => t.task_status === "cancelled" && t.end_reason === "服务重启，未完成任务已取消"));
    assert.ok(s.steps.every(st => st.step_status === "cancelled" && st.ended_at));
    assert.deepEqual(s.project, beforeProject);

    assert.equal(executed, 0);
    assert.deepEqual((await new ModelRepository(root).open(p.id)).read(), s);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("重启没有未完成任务保持空闲，新任务无需点击开始", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-restart-paused-"));
  try {
    const repository = new ModelRepository(root), p = projectFixture(), model = await repository.create(p);
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async ({ step }) => step.kind === "review" ? { result: { 是否通过: true, 原因: "" } } : { content: { body: "新摘要" } } });
    await service.recover(model);

    const r = await service.command({ type: "submit", project_id: p.id, request_id: "new", business_type: "project-summary", target_id: p.id, action: "regenerate" });
    await service.idle(p.id);
    assert.equal(model.read().tasks.find(t => t.id === r.task_id).task_status, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("启动恢复的通知等待宿主 Agent 时，runtime 仍能公布并读取新状态", { timeout: 5000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "meiji-restart-notice-"));
  let release, entered, runtime, timeout;
  const gate = new Promise(resolve => { release = resolve; }), noticeEntered = new Promise(resolve => { entered = resolve; });
  try {
    const repository = new ModelRepository(join(home, "storages", "meiji", "projects"), { databasePath: join(home, "storages", "meiji", "meiji.sqlite") }), p = projectFixture(), model = await repository.create(p);
    const pending = taskFixture(p, "project-summary", p.id, { episode_id: null });
    await model.update("setup", {}, s => {
      s.groups = [singleGroup(pending)]; s.tasks = [pending]; s.runtime.outbox.push({ id: "restart-notice", project_id: p.id, task_id: pending.id, group_id: null, session_id: "session-test", event: "submitted", status: "queued", reason: "", delivery_status: "pending", error: "" });
    });
    const creating = createAppRuntime({ home, sessionController: { resolveAgent: async () => { entered(); await gate; return { agent: { session: { append: async () => {} } } }; } } });
    try {
      runtime = await Promise.race([creating, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("通知阻塞了 runtime 启动")), 2000); })]);
    } finally { clearTimeout(timeout); }
    await noticeEntered;
    const restored = await runtime.repository.open(p.id);
    assert.equal(restored.read().tasks[0].task_status, "cancelled");

    release();
    await runtime.notices.drain(p.id);
    assert.ok(restored.read().runtime.outbox.every(n => n.delivery_status === "delivered"));
  } finally { release(); if (runtime) await runtime.dispose(); await rm(home, { recursive: true, force: true }); }
});

test("服务关闭作废运行任务，模型晚到结果不覆盖旧稿或作废终态", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-restart-late-"));
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  try {
    const repository = new ModelRepository(root), p = projectFixture(), model = await repository.create(p);
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async () => { enter(); await gate; return { content: { body: "不能提交的晚到结果" } }; } });
    const r = await service.command({ type: "submit", project_id: p.id, request_id: "before-stop", business_type: "project-summary", target_id: p.id, action: "regenerate" });
    await entered;
    const changed = new Promise(resolve => repository.once("change", resolve));
    const stopping = service.dispose();
    await changed;
    assert.equal(model.read().tasks.find(t => t.id === r.task_id).task_status, "cancelled");
    release();
    await stopping;
    assert.equal(model.read().project.project_summary.body, "摘要");

    assert.equal(model.read().tasks.find(t => t.id === r.task_id).task_status, "cancelled");
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});
test("S8-05 重启把运行和排队任务都记为已取消，恢复快照、保留旧稿与终态，新任务直接执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-restart-"));
  try {
    const repository = new ModelRepository(root),
      p = projectFixture(),
      model = await repository.create(p),
      task = taskFixture(p, "project-summary", p.id, {
        episode_id: null,
        task_status: "running",
        started_at: new Date().toISOString(),
      }),
      queued = taskFixture(p, "episode-summary", p.episodes[0].id, { queue_order: 2, previous_node_state: { status: "expired", reason: "上游已变化" } }),
      terminal = taskFixture(p, "project-summary", p.id, { episode_id: null, task_status: "failed", queue_order: 3, end_reason: "旧失败", ended_at: new Date().toISOString() }),
      done = { ...newStep(task, 1, "precheck"), step_status: "done", result: { ok: true }, started_at: task.started_at, ended_at: task.started_at },
      running = { ...newStep(task, 2, "generate"), step_status: "running", started_at: task.started_at };
    await model.update("crash-setup", {}, (s) => {
      s.groups = [task, queued, terminal].map(singleGroup);
      s.tasks = [task, queued, terminal];
      s.steps = [done, running, newStep(queued, 1, "precheck")];
      s.project.episodes[0].summary.node_state.status = "expired";
      s.project.episodes[0].summary.node_state.reason = queued.previous_node_state.reason;
      return {};
    });
    const freshRepository = new ModelRepository(root),
      restored = await freshRepository.open(p.id),
      service = new TaskService({
        repository: freshRepository,
        execute: async ({ step }) => step.kind === "review" ? { result: { 是否通过: true, 原因: "" } } : { content: { body: "重启后新摘要" } },
        commitOutput: commitContent,
      });
    await service.recover(restored);
    const snapshot = restored.read();
    assert.deepEqual(snapshot.tasks.map(t => t.task_status), ["cancelled", "cancelled", "failed"]);
    assert.ok(snapshot.tasks.slice(0, 2).every(t => /服务重启.*已取消/.test(t.end_reason) && t.ended_at));
    assert.deepEqual(snapshot.tasks[2], terminal);
    assert.deepEqual(snapshot.steps[0], done);
    assert.deepEqual(snapshot.steps.slice(1).map(st => st.step_status), ["cancelled", "cancelled"]);
    assert.equal(snapshot.project.project_summary.body, "摘要");
    assert.equal(snapshot.project.project_summary.node_state.status, "generated");
    assert.equal(snapshot.project.episodes[0].summary.body, "展示摘要");
    assert.equal(snapshot.project.episodes[0].summary.node_state.status, "expired");
    assert.equal(snapshot.project.episodes[0].summary.node_state.reason, "上游已变化");

    assert.deepEqual((await new ModelRepository(root).open(p.id)).read(), snapshot);
    await service.recover(restored);
    assert.deepEqual(restored.read(), snapshot, "重复恢复不产生新的变更");
    const fresh = await service.command({ type: "submit", project_id: p.id, request_id: "after-restart", business_type: "project-summary", target_id: p.id, action: "regenerate" });
    assert.notEqual(fresh.task_id, task.id);
    await service.idle(p.id);
    const after = restored.read();
    assert.deepEqual(after.tasks.slice(0,3), snapshot.tasks);
    assert.equal(after.tasks.find(t => t.id === fresh.task_id).task_status, "completed");
    assert.equal(after.project.project_summary.body, "重启后新摘要");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function singleGroup(task) {
  task.group_id = `tg_${randomUUID()}`; task.group_seq = 1;
  return { id: task.group_id, project_id: task.project_id, episode_id: task.episode_id, group_type: "single", source: task.source, shot_ids: [], action: task.action, created_at: task.created_at };
}
