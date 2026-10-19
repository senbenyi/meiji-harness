import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { mount } from "../client/workbench.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { commitContent } from "../server/handlers/content.js";
import { snapshotFixture, projectFixture, taskFixture } from "./fixtures/project.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";
import { randomUUID } from "node:crypto";
import { newStep } from "../shared/task-plan.js";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { fileURLToPath } from "node:url";

describe("refresh-preserve", () => {
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

  test("重新加载保留真实运行和排队任务，原请求完成后正常写回", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-refresh-"));
    const repository = new ModelRepository(root);
    const model = await repository.create(snapshotFixture().project);
    let entered, release, signal;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async context => {
      if (context.step.kind === 'review') return { result: { 是否通过: true, 类型: '', 原因: '' } };
      signal = context.signal;
      entered();
      await gate;
      return { content: { body: "晚到的新正文" } };
    } });
    const p = model.readAll().project;
    try {
      const first = await service.command({ type: "submit", project_id: p.id, request_id: "run", business_type: "episode-summary", target_id: p.episodes[0].id, action: "regenerate" });
      await started;
      await service.command({ type: "submit", project_id: p.id, request_id: "queue", business_type: "project-summary", target_id: p.id, action: "regenerate" });
      await withPanel(() => model.readAll(), command => service.command(command), async ({ app, commands }) => {
        await Promise.all([app.refresh(), app.refresh()]);
        assert.equal(commands.length, 0);
        assert.equal(signal.aborted, false);
        const saved = model.readAll();
        assert.equal(saved.tasks[0].task_status, "running");
        assert.equal(saved.tasks[1].task_status, "queued");

        assert.equal(saved.project.episodes[0].summary.node_state.status, "generated");
        assert.ok(saved.steps.some(s => s.task_id === first.task_id && s.step_status === 'running'));
        Object.assign(app.view, { page: "episode", episode_id: p.episodes[0].id, tab: "script" });
        await app.refresh();
        const card = app.shell.content.querySelector('[data-business="episode-summary"]');
        assert.equal(card.querySelector(".node-data-tag").textContent, "已生成");
        release();
        await service.idle(p.id);
        assert.equal(model.readAll().project.episodes[0].summary.body, "晚到的新正文");
        assert.equal(model.readAll().tasks[0].task_status, "completed");
      });
    } finally {
      release();
      await service.dispose();
      repository.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("首次排队及后续刷新、事件与恢复可见均只读取状态", async () => {
    const snapshot = snapshotFixture();
    snapshot.tasks = [{ id: "queued", business_type: "episode-summary", target_id: snapshot.project.episodes[0].id, task_status: "queued" }];
    await withPanel(() => structuredClone(snapshot), () => { snapshot.tasks[0].task_status = "cancelled"; return {}; }, async ({ app, commands, streams, dom }) => {
      await app.refresh();
      assert.equal(app.context.read().tasks[0].task_status, "queued");
      snapshot.runtime.revision++;
      snapshot.tasks[0].task_status = "running";
      snapshot.project.episodes[0].summary.node_state.status = "running";
      await app.refresh();
      streams[0].onmessage({ data: JSON.stringify({ project_id: snapshot.project.id, revision: snapshot.runtime.revision }) });
      document.dispatchEvent(new dom.window.Event("visibilitychange"));
      await app.refresh();
      assert.equal(commands.length, 0);
      assert.equal(app.context.read().project.episodes[0].summary.node_state.status, "running");
    });
  });

  test("刷新不发送取消命令，保留运行状态并读取稍后完成的结果", async () => {
    const snapshot = snapshotFixture();
    const episode = snapshot.project.episodes[0];
    episode.summary.node_state.status = "running";
    snapshot.tasks = [{ id: "running", business_type: "episode-summary", target_id: episode.id, task_status: "running" }];
    await withPanel(() => structuredClone(snapshot), async () => { assert.fail('刷新不得发送取消'); }, async ({ app, commands }) => {
      await app.refresh();
      assert.equal(app.context.read().tasks[0].task_status, 'running');
      assert.equal(episode.summary.node_state.status, "running");
      snapshot.tasks[0].task_status = 'completed';
      episode.summary.node_state.status = 'generated';
      episode.summary.body = '从原请求取回的结果';
      snapshot.runtime.revision++;
      await app.refresh();
      assert.equal(app.context.read().project.episodes[0].summary.body, '从原请求取回的结果');
      assert.equal(commands.length, 0);
    });
  });
});

describe("lifecycle", () => {
  test("旧格式明确拒绝，不读取正文或迁移；仅显式删除清理旧文件", async () => {
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
      const beforeProject = model.readAll().project;
      let executed = 0;
      const service = new TaskService({ repository, commitOutput: commitContent, execute: async () => { executed++; throw new Error("旧组合不应执行"); } });
      await seedQueuedTasks(model, p.episodes[0].shot_list.shots.flatMap(shot => ['seconds','storyboard','video'].map(b => [b,shot.id])));
      assert.equal(model.readAll().tasks.length, 6);
      const restored = await new ModelRepository(root).open(p.id);
      await service.recover(restored);
      const s = restored.readAll();
      assert.ok(s.tasks.every(t => t.task_status === "cancelled" && t.end_reason === "服务重启，未完成任务已取消"));
      assert.ok(s.steps.every(st => st.step_status === "cancelled" && st.ended_at));
      assert.deepEqual(s.project, beforeProject);

      assert.equal(executed, 0);
      assert.deepEqual((await new ModelRepository(root).open(p.id)).readAll(), s);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("重启没有未完成任务保持空闲，新任务无需点击开始", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-restart-paused-"));
    try {
      const repository = new ModelRepository(root), p = projectFixture(), model = await repository.create(p);
      const service = new TaskService({ repository, commitOutput: commitContent, execute: async ({ step }) => step.kind === "review" ? { result: { 是否通过: true, "类型": "", 原因: "" } } : { content: { body: "新摘要" } } });
      await service.recover(model);

      const r = await service.command({ type: "submit", project_id: p.id, request_id: "new", business_type: "project-summary", target_id: p.id, action: "regenerate" });
      await service.idle(p.id);
      assert.equal(model.readAll().tasks.find(t => t.id === r.task_id).task_status, "completed");
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
      assert.equal(restored.readAll().tasks[0].task_status, "cancelled");

      release();
      await runtime.notices.drain(p.id);
      assert.ok(restored.readAll().runtime.outbox.every(n => n.delivery_status === "delivered"));
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
      assert.equal(model.readAll().tasks.find(t => t.id === r.task_id).task_status, "cancelled");
      release();
      await stopping;
      assert.equal(model.readAll().project.project_summary.body, "摘要");

      assert.equal(model.readAll().tasks.find(t => t.id === r.task_id).task_status, "cancelled");
    } finally { release(); await rm(root, { recursive: true, force: true }); }
  });
  test("重启把运行和排队任务都记为已取消，恢复快照、保留旧稿与终态，新任务直接执行", async () => {
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
          execute: async ({ step }) => step.kind === "review" ? { result: { 是否通过: true, "类型": "", 原因: "" } } : { content: { body: "重启后新摘要" } },
          commitOutput: commitContent,
        });
      await service.recover(restored);
      const snapshot = restored.readAll();
      assert.deepEqual(snapshot.tasks.map(t => t.task_status), ["cancelled", "cancelled", "failed"]);
      assert.ok(snapshot.tasks.slice(0, 2).every(t => /服务重启.*已取消/.test(t.end_reason) && t.ended_at));
      assert.deepEqual(snapshot.tasks[2], terminal);
      assert.deepEqual(snapshot.steps[0], { ...done, has_prompt: false, has_http: false });
      assert.deepEqual(snapshot.steps.slice(1).map(st => st.step_status), ["cancelled", "cancelled"]);
      assert.equal(snapshot.project.project_summary.body, "摘要");
      assert.equal(snapshot.project.project_summary.node_state.status, "generated");
      assert.equal(snapshot.project.episodes[0].summary.body, "展示摘要");
      assert.equal(snapshot.project.episodes[0].summary.node_state.status, "expired");
      assert.equal(snapshot.project.episodes[0].summary.node_state.reason, "上游已变化");

      assert.deepEqual((await new ModelRepository(root).open(p.id)).readAll(), snapshot);
      await service.recover(restored);
      assert.deepEqual(restored.readAll(), snapshot, "重复恢复不产生新的变更");
      const fresh = await service.command({ type: "submit", project_id: p.id, request_id: "after-restart", business_type: "project-summary", target_id: p.id, action: "regenerate" });
      assert.notEqual(fresh.task_id, task.id);
      await service.idle(p.id);
      const after = restored.readAll();
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
});

describe("cleanup", () => {
  test("双端可达模块与全部源码无旧控制依赖；R1–R13 文件退出", async () => {
    const root = fileURLToPath(new URL("../", import.meta.url)),
      queue = ["index.js", "session.js", "client/workbench.js"],
      seen = new Set();
    while (queue.length) {
      const path = queue.pop();
      if (seen.has(path)) continue;
      seen.add(path);
      const url = new URL(path, new URL("../", import.meta.url)),
        source = await readFile(url, "utf8");
      for (const spec of [
        ...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g),
      ].map((m) => m[1]))
        if (spec.startsWith(".")) {
          const target = fileURLToPath(new URL(spec, url));
          assert.ok(target.startsWith(root));
          queue.push(target.slice(root.length));
        }
    }
    for (const path of seen)
      assert.ok(
        !/server\/(models|flow\/runs|flow\/operations)|shared\/(run-planner|run-templates|pipeline-cascade)|skills\/(task|review)|client\/(goal-request|run-preview|run-edit-choice)/.test(
          path,
        ),
        path,
      );
    const scan = async (dir) => {
      for (const name of await readdir(dir, { withFileTypes: true })) {
        if (
          name.name === "node_modules" ||
          name.name === "tests" ||
          name.name === "dev_docs"
        )
          continue;
        const path = join(dir, name.name);
        if (name.isDirectory()) await scan(path);
        else if (name.name.endsWith(".js")) {
          const source = await readFile(path, "utf8");
          for (const spec of [
            ...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g),
          ].map((m) => m[1]))
            if (spec.startsWith("."))
              await readFile(new URL(spec, new URL("file://" + path)), "utf8");
        }
      }
    };
    await scan(root);
    await import("../index.js");
    await import("../session.js");
    for (const old of [
      "server/data/run-store.js",
      "server/models/data/drama-model.js",
      "server/flow/runs/run-service.js",
      "server/flow/immediate-service.js",
      "server/host/harness-run-jobs.js",
      "server/host/harness-run-goals.js",
      "client/goal-request.js",
    ])
      await assert.rejects(readFile(join(root, old)), { code: "ENOENT" });
    const scripts = await readdir(join(root, "scripts"));
    // 旧项目迁移仍退出；这次只新增独立模型配置的显式迁移。
    assert.deepEqual(scripts.filter((name) => name.startsWith("migrate-")), ["migrate-settings-model.js"]);
    assert.ok(!seen.has("scripts/migrate-qwen-models.js"));
  });
});

describe("workbench", () => {
  test("完整面板刷新保留编辑草稿；切换拒绝旧项目；卸载拒绝晚到响应并释放 shell", async () => {
    const dom = new JSDOM("<body></body>", { url: "http://localhost", pretendToBeVisual: true }),
      saved = {};
    for (const key of [
      "window",
      "document",
      "localStorage",
      "EventSource",
      "fetch",
    ])
      saved[key] = globalThis[key];
    const sid = `session-${randomUUID()}`,
      other = `session-${randomUUID()}`,
      a = snapshotFixture(),
      b = snapshotFixture();
    a.project.name = "项目甲";
    a.project.creation_mode = "自由创作";
    b.project.name = "项目乙";
    let deferred, resolve, app;
    try {
      Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        EventSource: class {
          close() {
            this.closed = true;
          }
        },
      });
      dom.window.HTMLDialogElement.prototype.show = function () {
        this.open = true;
      };
      dom.window.HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new dom.window.Event("close"));
      };
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: sid }),
      );
      globalThis.fetch = async (url) => {
        if (deferred) await deferred;
        const selected = new URL(url, "http://localhost").searchParams.get(
            "session_id",
          ),
          snapshot = selected === other ? b : a;
        return {
          ok: true,
          json: async () => ({
            project_id: snapshot.project.id,
            snapshot: structuredClone(snapshot),
          }),
        };
      };
      app = mount();
      await app.refresh();
      const content = app.shell.content;
      content.querySelector("[aria-label=编辑创作方向]").click();
      const area = content.querySelector("dialog textarea");
      area.value = "草稿不丢";
      a.runtime.revision++;
      await app.refresh();
      assert.equal(content.querySelector("dialog textarea"), area);
      assert.equal(area.value, "草稿不丢");
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: other }),
      );
      await new Promise((done, reject) => {
        const timer = setInterval(() => {
            if (app.context.read()?.project.id === b.project.id) {
              clearInterval(timer);
              clearTimeout(timeout);
              done();
            }
          }, 20),
          timeout = setTimeout(() => {
            clearInterval(timer);
            reject(Error("切换超时"));
          }, 1800);
      });
      assert.equal(content.querySelector("dialog"), null);
      assert.equal(app.shell.root.querySelector(".brand").textContent, "项目乙");
      deferred = new Promise((r) => (resolve = r));
      const pending = app.refresh();
      app.dispose();
      resolve();
      await pending;
      assert.equal(document.querySelector("meiji-workbench"), null);
      assert.equal(document.head.querySelector("style"), null);
    } finally {
      app?.dispose();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      dom.window.close();
    }
  });
});
