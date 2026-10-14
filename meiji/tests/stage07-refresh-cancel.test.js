import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { mount } from "../client/workbench.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { commitContent } from "../server/handlers/content.js";
import { snapshotFixture } from "./fixtures/project.js";

async function withPanel(read, cancel, work) {
  const dom = new JSDOM("<main></main>", { url: "http://localhost", pretendToBeVisual: true });
  const keys = ["window", "document", "localStorage", "fetch", "EventSource"];
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  const commands = [], streams = [];
  let app;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  localStorage.setItem("dsh.sessions.current", JSON.stringify({ sessionId: "session-" + crypto.randomUUID() }));
  globalThis.EventSource = class { constructor() { streams.push(this); } close() {} };
  globalThis.fetch = async (url, options = {}) => {
    let data;
    if (url.includes("task-command")) {
      const { command } = JSON.parse(options.body);
      commands.push(command);
      data = await cancel(command);
    } else if (url.includes("context?")) {
      const snapshot = read();
      data = { project_id: snapshot.project.id, snapshot };
    } else if (url.endsWith("models")) {
      data = { settings: { output_language: "zh-CN" } };
    } else throw new Error(`意外请求 ${url}`);
    return { ok: true, json: async () => data };
  };
  try {
    app = mount();
    await work({ app, commands, streams, dom });
  } finally {
    app?.dispose();
    Object.assign(globalThis, previous);
    dom.window.close();
  }
}

test("重新加载取消真实运行任务，Model 保存后渲染，abort 后晚到结果不写回", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-refresh-"));
  const repository = new ModelRepository(root);
  const model = await repository.create(snapshotFixture().project);
  let entered, release, signal;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const service = new TaskService({ repository, commitOutput: commitContent, execute: async context => {
    signal = context.signal;
    entered();
    await gate;
    return { content: { body: "晚到的新正文" } };
  } });
  const p = model.read().project;
  try {
    const first = await service.command({ type: "submit", project_id: p.id, request_id: "run", business_type: "episode-summary", target_id: p.episodes[0].id, action: "regenerate" });
    await started;
    await service.command({ type: "submit", project_id: p.id, request_id: "queue", business_type: "project-summary", target_id: p.id, action: "regenerate" });
    await withPanel(() => model.read(), command => service.command(command), async ({ app, commands }) => {
      await Promise.all([app.refresh(), app.refresh()]);
      assert.equal(commands.length, 1);
      assert.equal(commands[0].task_id, first.task_id);
      assert.equal(signal.aborted, true);
      const saved = model.read();
      assert.equal(saved.tasks[0].task_status, "cancelled");
      assert.equal(saved.tasks[1].task_status, "cancelled");

      assert.equal(saved.project.episodes[0].summary.node_state.status, "cancelled");
      assert.ok(saved.steps.filter(s => s.task_id === first.task_id).every(s => ["done", "cancelled"].includes(s.step_status)));
      Object.assign(app.view, { page: "episode", episode_id: p.episodes[0].id, tab: "script" });
      await app.refresh();
      const card = app.shell.content.querySelector('[data-business="episode-summary"]');
      assert.equal(card.querySelector(".node-ui-status").textContent, "已取消");
      release();
      await service.idle(p.id);
      assert.equal(model.read().project.episodes[0].summary.body, p.episodes[0].summary.body);
      assert.equal(model.read().tasks[0].task_status, "cancelled");
    });
  } finally {
    release();
    await service.dispose();
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("首次仅排队也取消，后续普通刷新、事件与恢复可见不取消新任务", async () => {
  const snapshot = snapshotFixture();
  snapshot.tasks = [{ id: "queued", business_type: "episode-summary", target_id: snapshot.project.episodes[0].id, task_status: "queued" }];
  await withPanel(() => structuredClone(snapshot), () => { snapshot.tasks[0].task_status = "cancelled"; return {}; }, async ({ app, commands, streams, dom }) => {
    await app.refresh();
    assert.equal(app.context.read().tasks[0].task_status, "cancelled");
    snapshot.runtime.revision++;
    snapshot.tasks[0].task_status = "running";
    snapshot.project.episodes[0].summary.node_state.status = "running";
    await app.refresh();
    streams[0].onmessage({ data: JSON.stringify({ project_id: snapshot.project.id, revision: snapshot.runtime.revision }) });
    document.dispatchEvent(new dom.window.Event("visibilitychange"));
    await app.refresh();
    assert.equal(commands.length, 1);
    assert.equal(app.context.read().project.episodes[0].summary.node_state.status, "running");
  });
});

test("初始化取消失败不伪造状态，后续刷新重试成功才展示已取消", async () => {
  const snapshot = snapshotFixture();
  const episode = snapshot.project.episodes[0];
  episode.summary.node_state.status = "running";
  snapshot.tasks = [{ id: "running", business_type: "episode-summary", target_id: episode.id, task_status: "running" }];
  let fail = true;
  await withPanel(() => structuredClone(snapshot), async () => {
    if (fail) throw new Error("取消连接失败");
    snapshot.tasks[0].task_status = "cancelled";
    episode.summary.node_state.status = "cancelled";
    episode.summary.node_state.reason = "用户取消";
    snapshot.runtime.revision++;
    return {};
  }, async ({ app }) => {
    await assert.rejects(app.refresh(), /取消连接失败/);
    assert.equal(app.context.read(), null);
    assert.equal(episode.summary.node_state.status, "running");
    fail = false;
    await app.refresh();
    assert.equal(app.context.read().project.episodes[0].summary.node_state.status, "cancelled");
  });
});
