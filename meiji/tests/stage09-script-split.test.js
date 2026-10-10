import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyProject, emptyEpisode } from "../shared/project-contract.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createTextHandler, promptValues } from "../server/handlers/text-handler.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import {
  scriptParagraphs,
  numberedScript,
  buildSplit,
} from "../server/handlers/script-split.js";
import { loadTemplate, renderTemplate } from "../server/prompts/yaml-prompts.js";
import { createAppRuntime } from "../server/runtime/app-runtime.js";

const script = "第一场 酒馆\n武松：店家，再来一碗！\n\n店家：客官，三碗不过冈。\n第二场 景阳冈\n武松上冈，遇虎。\n武松打虎。";
const rows = [
  { 序号: 1, 起始段落: "P001", 结束段落: "P003", 预估时长秒: 60 },
  { 序号: 2, 起始段落: "P004", 结束段落: "P006", 预估时长秒: 90 },
];

test("拆分段落：空行并入上一段，拼接与原文逐字一致", () => {
  const parts = scriptParagraphs(script);
  assert.equal(parts.length, 6);
  assert.equal(parts.join(""), script);
  assert.equal(scriptParagraphs("\n\n甲\n").join(""), "\n\n甲\n");
  assert.match(numberedScript(script), /^P001 第一场 酒馆\nP002 武松：店家，再来一碗！\nP003 店家/);
});

test("拆分校验：按段落原文写入各集，遗漏、重叠、倒序、未到结尾、序号与时长错误均拒绝", () => {
  const result = buildSplit(script, { 剧集: rows });
  assert.deepEqual(result.剧集.map((e) => e.时长秒), [60, 90]);
  assert.equal(result.剧集.map((e) => e.剧情).join(""), script);
  assert.equal(result.剧集[1].剧情, "第二场 景阳冈\n武松上冈，遇虎。\n武松打虎。");
  const bad = (patch, pattern) =>
    assert.throws(() => buildSplit(script, { 剧集: patch(structuredClone(rows)) }), pattern);
  bad((r) => ((r[1].起始段落 = "P005"), r), /遗漏/);
  bad((r) => ((r[1].起始段落 = "P003"), r), /重叠或倒序/);
  bad((r) => ((r[1].结束段落 = "P005"), r), /未到剧本结尾/);
  bad((r) => ((r[1].序号 = 3), r), /连续递增/);
  bad((r) => ((r[0].预估时长秒 = 0), r), /正整数/);
  bad((r) => ((r[0].结束段落 = "P099"), r), /不存在/);
});

function scriptProject() {
  const p = emptyProject({ 名称: "武松", 创作方式: "剧本" });
  p.剧本.正文 = script;
  return p;
}

test("暂停时会话拆分保持排队，面板重复拆分复用同一任务并执行", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-split-start-"));
  try {
    const p = scriptProject(), repository = new ModelRepository(root), model = await repository.create(p);
    await model.update("pause", {}, s => { s.runtime.queue_stopped = true; });
    let calls = 0;
    const text = createTextHandler({ chat: async () => { calls++; return { 剧集: rows }; } });
    const service = new TaskService({ repository, commitOutput: commitContent,
      execute: createHandlerRegistry({ text, media: async () => { throw new Error("不应调用媒体"); } }) });
    const command = { type: "submit", project_id: p.id, target_id: p.id, business_type: "script-split", action: "generate", request_id: "session-split" };
    const queued = await service.command(command, { source: "session", session_id: "s" });
    await service.idle(p.id);
    assert.equal(model.read().runtime.queue_stopped, true);
    assert.equal(model.read().tasks[0].task_status, "queued");
    assert.equal(calls, 0);
    const started = await service.command({ ...command, request_id: "panel-split" });
    assert.equal(started.task_id, queued.task_id);
    await service.idle(p.id);
    assert.equal(model.read().tasks.length, 1);
    assert.equal(model.read().tasks[0].task_status, "completed");
    assert.equal(calls, 1);
    assert.equal((await new ModelRepository(root).open(p.id)).read().project.剧集.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("暂停队列有其他业务时拒绝直接拆分，不恢复其他任务、不新增拆分", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-split-conflict-"));
  try {
    const p = scriptProject(), repository = new ModelRepository(root), model = await repository.create(p);
    await model.update("pause", {}, s => { s.runtime.queue_stopped = true; });
    let calls = 0;
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async () => { calls++; throw new Error("不应执行"); } });
    const command = { type: "submit", project_id: p.id, target_id: p.id, business_type: "project-summary", action: "generate", request_id: "summary" };
    const queued = await service.command(command);
    await service.idle(p.id);
    assert.equal(model.read().runtime.queue_stopped, true);
    await assert.rejects(service.command({ ...command, business_type: "script-split", request_id: "split" }), e => e.code === "TASK_CONFLICT" && e.conflicts[0].task_id === queued.task_id);
    assert.equal(model.read().tasks.length, 1);
    assert.equal(model.read().tasks[0].task_status, "queued");
    assert.equal(model.read().runtime.queue_stopped, true);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("拆分剧集真实任务：失败暂停后面板再次拆分直接执行，旧失败保留，成功写入剧情与磁盘", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-split-"));
  try {
    const p = scriptProject(),
      repository = new ModelRepository(root),
      model = await repository.create(p),
      seen = [];
    let failOnce = true;
    const text = createTextHandler({
      chat: async ({ step, prompt }) => {
        seen.push(step.kind);
        assert.ok(prompt.includes("P006 武松打虎。"));
        assert.ok(prompt.includes("150"));
        if (failOnce) { failOnce = false; throw new Error("模型返回失败"); }
        return { 剧集: rows };
      },
    });
    const service = new TaskService({
      repository,
      commitOutput: commitContent,
      execute: createHandlerRegistry({ text, media: async () => { throw new Error("不应调用媒体"); } }),
    });
    const command = {
      type: "submit",
      project_id: p.id,
      request_id: "split",
      business_type: "script-split",
      target_id: p.id,
      action: "generate",
    };
    const first = await service.command(command);
    await service.idle(p.id);
    assert.equal(model.read().tasks.find(t => t.id === first.task_id).task_status, "failed");
    assert.equal(model.read().runtime.queue_stopped, true);
    const r = await service.command({ ...command, request_id: "split-again" });
    await service.idle(p.id);
    const s = model.read(),
      task = s.tasks.find((t) => t.id === r.task_id);
    assert.equal(task.task_status, "completed", task.end_reason);
    assert.deepEqual(seen, ["generate", "generate"]);
    assert.equal(s.tasks.find(t => t.id === first.task_id).task_status, "failed");
    assert.deepEqual(
      s.steps.filter((x) => x.task_id === task.id).map((x) => x.kind),
      ["precheck", "generate"],
    );
    assert.equal(s.project.剧集.length, 2);
    assert.equal(s.project.剧集.map((e) => e.剧情).join(""), script);
    assert.deepEqual(s.project.剧集.map((e) => [e.序号, e.时长秒]), [[1, 60], [2, 90]]);
    assert.ok(s.project.剧集.every((e) => e.故事大纲.状态 === "empty"));
    const restored = await new ModelRepository(root).open(p.id);
    assert.deepEqual(restored.read().project.剧集, s.project.剧集);
    assert.equal(restored.read().tasks.find(t => t.id === r.task_id).task_status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("拆分前置：只检查剧本与参考单集时长，以及剧集上没有未结束任务", () => {
  const p = scriptProject(),
    task = { id: "t_x", business_type: "script-split", target_id: p.id, action: "generate", previous_node_state: null },
    snap = (tasks = []) => ({ project: p, tasks });
  assert.equal(precheck(snap(), task).passed, true);
  p.剧集 = [emptyEpisode({ 剧情: script })];
  assert.equal(precheck(snap(), { ...task, action: "regenerate" }).passed, true);
  assert.throws(
    () => precheck(snap([{ id: "t_y", episode_id: p.剧集[0].id, task_status: "queued" }]), task),
    /未结束任务/,
  );
  p.参考单集时长秒 = 0;
  assert.throws(() => precheck(snap(), task), /参考单集时长/);
  p.参考单集时长秒 = 150;
  p.剧本.正文 = " ";
  assert.throws(() => precheck(snap(), task), /剧本为空/);
});

test("拆分与摘要模板：占位符齐全，摘要资料来自本集剧情", async () => {
  const p = scriptProject();
  p.剧集 = buildSplit(script, { 剧集: rows }).剧集.map((e) => emptyEpisode(e));
  const split = { business_type: "script-split", target_id: p.id, action: "generate", opinion: "" };
  for (const suffix of ["generate", "regenerate"]) {
    const prompt = renderTemplate(
      await loadTemplate(`script-split-${suffix}`),
      promptValues({ project: p, steps: [] }, { ...split, opinion: "第二集再短一点" }, null, "generate"),
    );
    assert.ok(prompt.user.includes("P001 第一场 酒馆"));
    if (suffix === "regenerate") assert.ok(prompt.user.includes("P004"));
  }
  const e = p.剧集[1],
    summary = renderTemplate(
      await loadTemplate("episode-summary-generate"),
      promptValues({ project: p, steps: [] }, { business_type: "episode-summary", target_id: e.id, action: "generate", opinion: "" }, null, "generate"),
    );
  assert.ok(summary.user.includes("武松打虎。"));
  assert.ok(!summary.user.includes("故事小段"));
});

test("剧本创作方式不能逐集新增；编辑剧情使展示摘要与故事大纲过期", async () => {
  const home = await mkdtemp(join(tmpdir(), "meiji-split-runtime-"));
  let runtime;
  try {
    runtime = await createAppRuntime({ home });
    const p = scriptProject(),
      e = emptyEpisode({ 剧情: script });
    e.摘要 = { 状态: "generated", 原因: "", 正文: "摘要" };
    e.故事大纲 = { 状态: "generated", 原因: "", 小段: [{ 序号: 1, 时长秒: 150, 正文: "故事" }] };
    p.剧集 = [e];
    const model = await runtime.repository.create(p),
      sid = `session-${randomUUID()}`;
    await runtime.bindings.bind(sid, p.id);
    await assert.rejects(
      runtime.projectCommand({ type: "add-episode", project_id: p.id, request_id: "add", fields: {} }, sid),
      /拆分剧集/,
    );
    await runtime.projectCommand(
      { type: "edit-episode", project_id: p.id, request_id: "plot", episode_id: e.id, fields: { 剧情: "改过的剧情" } },
      sid,
    );
    const after = model.read().project.剧集[0];
    assert.equal(after.剧情, "改过的剧情");
    assert.equal(after.摘要.状态, "expired");
    assert.equal(after.故事大纲.状态, "expired");
    assert.equal(after.故事大纲.小段[0].正文, "故事");
  } finally {
    await runtime?.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test("面板：剧本创作方式显示拆分剧集弹窗并依次提交时长与拆分；剧情标签上方显示剧情原文", async () => {
  const { JSDOM } = await import("jsdom");
  const { renderTaskPanel } = await import("../client/task-panel.js");
  const { snapshotFixture } = await import("./fixtures/project.js");
  const dom = new JSDOM("<main></main>", { url: "http://localhost" }),
    saved = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch },
    calls = [], errors = [];
  let releaseSave, failPath = null;
  Object.assign(globalThis, { document: dom.window.document, window: dom.window });
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (calls.length === 1) await new Promise(resolve => { releaseSave = resolve; });
    if (url === failPath) return { ok: false, status: 400, json: async () => ({ message: "提交失败测试" }) };
    return { ok: true, json: async () => ({}) };
  };
  try {
    const root = document.querySelector("main"),
      snap = snapshotFixture(),
      view = { page: "overview", tab: "script" },
      context = { session_id: "s", view, refresh: async () => {}, onError: message => errors.push(message), paint: () => renderTaskPanel(root, snap, context) };
    snap.project.创作方式 = "剧本";
    context.paint();
    assert.equal(root.querySelector("[aria-label=新增剧集]"), null);
    root.querySelector("[aria-label=重新拆分剧集]").click();
    const dialog = root.querySelector("dialog");
    assert.match(dialog.textContent, /参考单集时长（秒）/);
    dialog.querySelector("[name=参考单集时长秒]").value = "120";
    dialog.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(dialog.open, false);
    assert.equal(root.querySelector("dialog"), null);
    assert.equal(calls.length, 1, "时长请求未返回时弹框应已关闭，拆分尚未提交");
    releaseSave();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.map((c) => c.url), ["/api/meiji/project-command", "/api/meiji/task-command"]);
    assert.deepEqual(calls[0].body.command.fields, { 参考单集时长秒: 120 });
    assert.equal(calls[1].body.command.business_type, "script-split");
    assert.equal(calls[1].body.command.action, "regenerate");
    for (const path of ["/api/meiji/project-command", "/api/meiji/task-command"]) {
      failPath = path;
      const before = calls.length;
      root.querySelector("[aria-label=重新拆分剧集]").click();
      root.querySelector("dialog form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      assert.equal(root.querySelector("dialog"), null);
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      assert.equal(calls.length - before, path.endsWith("project-command") ? 1 : 2);
    }
    assert.deepEqual(errors, ["提交失败测试", "提交失败测试"]);
    view.page = "episode";
    view.episode_id = snap.project.剧集[0].id;
    view.tab = "script";
    context.paint();
    assert.match(root.querySelector(".episode-plot").textContent, /本集剧情原文/);
    assert.match(root.querySelector("[data-business=outline]").textContent, /故事大纲/);
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});
