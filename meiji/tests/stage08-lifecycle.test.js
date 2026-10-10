import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
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

test("重启仅排队组合：全组作废并保留统一原因，节点和媒体恢复，不自动执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-restart-group-"));
  try {
    const repository = new ModelRepository(root), p = projectFixture(), model = await repository.create(p);
    await model.update("pause", {}, s => { s.runtime.queue_stopped = true; s.project.剧集[0].镜头表.镜头[0].每秒分镜.状态 = "expired"; s.project.剧集[0].镜头表.镜头[0].每秒分镜.原因 = "之前过期"; });
    const beforeProject = model.read().project;
    let executed = 0;
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async () => { executed++; throw new Error("旧组合不应执行"); } });
    await service.command({ type: "submit-group", project_id: p.id, request_id: "group", group_type: "episode-film", episode_id: p.剧集[0].id });
    assert.equal(model.read().tasks.length, 8);
    const restored = await new ModelRepository(root).open(p.id);
    await service.recover(restored);
    const s = restored.read();
    assert.ok(s.tasks.every(t => t.task_status === "superseded" && t.end_reason === "服务重启，未完成任务已作废"));
    assert.ok(s.steps.every(st => st.step_status === "superseded" && st.ended_at));
    assert.deepEqual(s.project, beforeProject);
    assert.equal(s.runtime.queue_stopped, false);
    assert.equal(executed, 0);
    assert.deepEqual((await new ModelRepository(root).open(p.id)).read(), s);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("重启没有未完成任务仍解除旧暂停，新任务无需点击开始", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-restart-paused-"));
  try {
    const repository = new ModelRepository(root), p = projectFixture(), model = await repository.create(p);
    await model.update("pause", {}, s => { s.runtime.queue_stopped = true; });
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async ({ step }) => step.kind === "review" ? { result: { 通过: true, 原因: "" } } : { content: { 正文: "新摘要" } } });
    await service.recover(model);
    assert.equal(model.read().runtime.queue_stopped, false);
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
    const repository = new ModelRepository(join(home, "storages", "meiji", "projects")), p = projectFixture(), model = await repository.create(p);
    const pending = taskFixture(p, "project-summary", p.id, { episode_id: null });
    await model.update("setup", {}, s => {
      s.tasks = [pending]; s.project.项目摘要.状态 = "queued"; s.runtime.queue_stopped = true;
      s.runtime.outbox.push({ id: "restart-notice", project_id: p.id, task_id: pending.id, group_id: null, session_id: "session-test", event: "submitted", status: "queued", reason: "", delivery_status: "pending", error: "" });
    });
    const creating = createAppRuntime({ home, sessionController: { resolveAgent: async () => { entered(); await gate; return { agent: { session: { append: async () => {} } } }; } } });
    try {
      runtime = await Promise.race([creating, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("通知阻塞了 runtime 启动")), 2000); })]);
    } finally { clearTimeout(timeout); }
    await noticeEntered;
    const restored = await runtime.repository.open(p.id);
    assert.equal(restored.read().tasks[0].task_status, "superseded");
    assert.equal(restored.read().runtime.queue_stopped, false);
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
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async () => { enter(); await gate; return { content: { 正文: "不能提交的晚到结果" } }; } });
    const r = await service.command({ type: "submit", project_id: p.id, request_id: "before-stop", business_type: "project-summary", target_id: p.id, action: "regenerate" });
    await entered;
    const changed = new Promise(resolve => repository.once("change", resolve));
    const stopping = service.dispose();
    await changed;
    assert.equal(model.read().tasks.find(t => t.id === r.task_id).task_status, "superseded");
    release();
    await stopping;
    assert.equal(model.read().project.项目摘要.正文, "摘要");
    assert.equal(model.read().runtime.queue_stopped, false);
    assert.equal(model.read().tasks.find(t => t.id === r.task_id).task_status, "superseded");
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});
test("S8-05 重启作废运行和排队任务，恢复快照、保留旧稿与终态，新任务直接执行", async () => {
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
      queued = taskFixture(p, "episode-summary", p.剧集[0].id, { queue_order: 2, previous_node_state: { 状态: "expired", 原因: "上游已变化" } }),
      terminal = taskFixture(p, "project-summary", p.id, { episode_id: null, task_status: "failed", queue_order: 3, end_reason: "旧失败", ended_at: new Date().toISOString() }),
      done = { ...newStep(task, 1, "precheck"), step_status: "done", result: { ok: true }, started_at: task.started_at, ended_at: task.started_at },
      running = { ...newStep(task, 2, "generate"), step_status: "running", started_at: task.started_at };
    await model.update("crash-setup", {}, (s) => {
      s.tasks = [task, queued, terminal];
      s.steps = [done, running, newStep(queued, 1, "precheck")];
      s.project.项目摘要.状态 = "running";
      s.project.剧集[0].摘要.状态 = "queued";
      s.runtime.queue_stopped = true;
      return {};
    });
    const freshRepository = new ModelRepository(root),
      restored = await freshRepository.open(p.id),
      service = new TaskService({
        repository: freshRepository,
        execute: async ({ step }) => step.kind === "review" ? { result: { 通过: true, 原因: "" } } : { content: { 正文: "重启后新摘要" } },
        commitOutput: commitContent,
      });
    await service.recover(restored);
    const snapshot = restored.read();
    assert.deepEqual(snapshot.tasks.map(t => t.task_status), ["superseded", "superseded", "failed"]);
    assert.ok(snapshot.tasks.slice(0,2).every(t => /服务重启.*已作废/.test(t.end_reason) && t.ended_at));
    assert.deepEqual(snapshot.tasks[2], terminal);
    assert.deepEqual(snapshot.steps[0], done);
    assert.deepEqual(snapshot.steps.slice(1).map(st => st.step_status), ["superseded", "superseded"]);
    assert.equal(snapshot.project.项目摘要.正文, "摘要");
    assert.equal(snapshot.project.项目摘要.状态, "cancelled");
    assert.equal(snapshot.project.剧集[0].摘要.正文, "展示摘要");
    assert.equal(snapshot.project.剧集[0].摘要.状态, "expired");
    assert.equal(snapshot.project.剧集[0].摘要.原因, "上游已变化");
    assert.equal(snapshot.runtime.queue_stopped, false);
    assert.deepEqual((await new ModelRepository(root).open(p.id)).read(), snapshot);
    await service.recover(restored);
    assert.deepEqual(restored.read(), snapshot, "重复恢复不产生新的变更");
    const fresh = await service.command({ type: "submit", project_id: p.id, request_id: "after-restart", business_type: "project-summary", target_id: p.id, action: "regenerate" });
    assert.notEqual(fresh.task_id, task.id);
    await service.idle(p.id);
    const after = restored.read();
    assert.deepEqual(after.tasks.slice(0,3), snapshot.tasks);
    assert.equal(after.tasks.find(t => t.id === fresh.task_id).task_status, "completed");
    assert.equal(after.project.项目摘要.正文, "重启后新摘要");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
