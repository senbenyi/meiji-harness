import { taskNodeInput } from '../server/handlers/node-inputs.js';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyProject, emptyEpisode } from "../shared/project_contract.js";
import { approveScriptReview } from "./fixtures/project.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import {
  scriptParagraphs,
  numberedScript,
  buildSplit,
  paragraphNumber,
} from "../server/handlers/script-split.js";
import { renderTaskPrompt } from "./fixtures/ai.js";
import { createAppRuntime } from "../server/runtime/app-runtime.js";

const script = "第一场 酒馆\n武松：店家，再来一碗！\n\n店家：客官，三碗不过冈。\n第二场 景阳冈\n武松上冈，遇虎。\n武松打虎。";
const rows = [
  { 序号: 1, 起始段落: "P001", 结束段落: "P003", 预估时长秒: 60 },
  { 序号: 2, 起始段落: "P004", 结束段落: "P006", 预估时长秒: 90 },
];
const covered = (剧集) => ({ 剧集, 排除段落: [] });

test("拆分段落：空行并入上一段，拼接与原文逐字一致", () => {
  const parts = scriptParagraphs(script);
  assert.equal(parts.length, 6);
  assert.equal(parts.join(""), script);
  assert.equal(scriptParagraphs("\n\n甲\n").join(""), "\n\n甲\n");
  assert.match(numberedScript(script), /^P001 第一场 酒馆\nP002 武松：店家，再来一碗！\nP003 店家/);
});

test("拆分只保留剧情：模型排除人物说明和间隔后才不写入剧集，程序不事先删除", () => {
  const screenplay = [
    "《武松：兄长不死》",
    "",
    "主要人物",
    "武松／林峥，28岁。现代消防员林峥穿越成为武松。",
    "武大郎，35岁。卖炊饼为生。",
    "",
    "==================================================",
    "第一场：哥哥还活着",
    "预计时长：5分钟",
    "时间：清晨至上午",
    "地点：现代火场／武家卧房",
    "==================================================",
    "",
    "【00:00—00:40】",
    "",
    "林峥猛然睁眼。",
    "",
    "武松：哥，你还活着。",
    "",
    "==================================================",
    "第二场：帘子后面的人",
    "预计时长：5分钟",
    "时间：当日下午",
    "地点：王婆茶坊",
    "==================================================",
    "",
    "【05:00—06:10】",
    "",
    "王婆把一只茶壶放在后房桌上。",
  ].join("\n");
  const numbered = numberedScript(screenplay);
  assert.match(numbered, /^P001 《武松：兄长不死》/);
  assert.match(numbered, /主要人物/);
  assert.match(numbered, /={3,}/);
  assert.match(numbered, /预计时长/);
  const parts = scriptParagraphs(screenplay);
  const at = (snippet) => parts.findIndex((part) => part.includes(snippet));
  const ranges = [[at("第一场"), at("你还活着")], [at("第二场"), parts.length - 1]];
  const nonPlot = (part) => /《|主要人物|穿越|武大郎|^=+$|预计时长|^时间：|^地点：|^【/.test(part.trim());
  const raw = {
    剧集: ranges.map(([start, end], index) => ({ 序号: index + 1, 起始段落: paragraphNumber(start), 结束段落: paragraphNumber(end), 预估时长秒: 60 })),
    排除段落: parts.flatMap((part, index) => index < ranges[0][0] || nonPlot(part) ? [paragraphNumber(index)] : []),
  };
  assert.ok(raw.排除段落.includes(paragraphNumber(at("预计时长"))));
  assert.throws(() => buildSplit(screenplay, { 剧集: raw.剧集 }), /遗漏/);
  const split = buildSplit(screenplay, raw);
  const plot = split.episodes.map((episode) => episode.plot).join("");
  assert.match(plot, /第一场：哥哥还活着/);
  assert.match(plot, /林峥猛然睁眼/);
  assert.match(plot, /第二场：帘子后面的人/);
  assert.doesNotMatch(plot, /主要人物|={3,}|预计时长|【05:00/);
  const project = emptyProject({ name: "武松", creation_mode: "剧本" });
  project.script.body = screenplay;
  const prompt = renderTaskPrompt({ project, steps: [] }, { business_type: "script-split", target_id: project.id, action: "generate", opinion: "" }, null, "generate");
  assert.match(prompt.system, /程序不会事先删除或判断/);
  assert.match(prompt.user, /主要人物/);
  assert.match(prompt.system, /排除段落/);
});

test("拆分校验：按段落原文写入各集，遗漏、重叠、倒序、未到结尾、序号与时长错误均拒绝", () => {
  const result = buildSplit(script, { 剧集: rows });
  assert.deepEqual(result.episodes.map((e) => e.duration_seconds), [60, 90]);
  assert.equal(result.episodes.map((e) => e.plot).join(""), script);
  assert.equal(result.episodes[1].plot, "第二场 景阳冈\n武松上冈，遇虎。\n武松打虎。");
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
  const p = emptyProject({ name: "武松", creation_mode: "剧本" });
  p.script.body = script;
  return approveScriptReview(p);
}

test("会话拆分自动启动，执行中面板重复提交复用同一任务", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-split-start-"));
  let release, enter;
  const gate = new Promise(r=>release=r), entered = new Promise(r=>enter=r);
  let service;
  try {
    const p = scriptProject(), repository = new ModelRepository(root), model = await repository.create(p);
    let calls = 0;
    const text = createTextHandler({ chat: async ({ step }) => { if (step.kind === "review") return { 是否通过: true, 原因: "" }; calls++; enter(); await gate; return covered(rows); } });
    service = new TaskService({ repository, commitOutput: commitContent,
      execute: createHandlerRegistry({ text, media: async () => { throw Error("不应调用媒体"); } }) });
    const command = { type:"submit",project_id:p.id,target_id:p.id,business_type:"script-split",action:"generate",request_id:"session-split" };
    const first = await service.command(command,{source:"session",session_id:"s"});
    await entered;
    const duplicate = await service.command({...command,request_id:"panel-split"});
    assert.equal(first.task_id,duplicate.task_id);
    release(); await service.idle(p.id);
    assert.equal(model.read().tasks.length,1);
    assert.equal(model.read().tasks[0].task_status,"completed");
    assert.equal(calls,1);
  } finally { release(); await service?.dispose(); await rm(root,{recursive:true,force:true}); }
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
      chat: async ({ task, step, messages }) => {
    if (step.kind === "review") return { 是否通过: true, 原因: "" };
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
        assert.equal(task.business_type, "script-split", "拆分不应调用剧集摘要");
        seen.push(step.kind);
        assert.ok(prompt.includes("P006 武松打虎。"));
        assert.ok(prompt.includes("150"));
        if (failOnce) { failOnce = false; throw new Error("模型返回失败"); }
        return covered(rows);
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

    const r = await service.command({ ...command, request_id: "split-again" });
    await service.idle(p.id);
    const s = model.read(),
      task = s.tasks.find((t) => t.id === r.task_id);
    assert.equal(task.task_status, "completed", task.end_reason);
    assert.deepEqual(seen, ["generate", "generate"]);
    assert.equal(s.tasks.find(t => t.id === first.task_id).task_status, "failed");
    assert.deepEqual(
      s.steps.filter((x) => x.task_id === task.id).map((x) => x.kind),
      ["precheck", "generate", "review", "review"],
    );
    assert.equal(s.project.episodes.length, 2);
    assert.equal(s.tasks.filter(t => t.group_id === task.group_id).length, 1);
    assert.ok(s.tasks.every(t => t.business_type === "script-split"));
    assert.ok(s.project.episodes.every(e => e.summary.body === "" && e.summary.node_state.status === "empty"));
    assert.equal(s.project.episodes.map((e) => e.plot).join(""), script);
    assert.deepEqual(s.project.episodes.map((e) => [e.sequence, e.duration_seconds]), [[1, 60], [2, 90]]);
    assert.ok(s.project.episodes.every((e) => e.story_outline.node_state.status === "empty"));
    const restored = await new ModelRepository(root).open(p.id);
    assert.deepEqual(restored.read().project.episodes, s.project.episodes);
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
  p.episodes = [emptyEpisode({ plot: script })];
  assert.equal(precheck(snap(), { ...task, action: "regenerate" }).passed, true);
  assert.throws(
    () => precheck(snap([{ id: "t_y", episode_id: p.episodes[0].id, task_status: "queued" }]), task),
    /未结束任务/,
  );
  p.reference_episode_duration_seconds = 0;
  assert.throws(() => precheck(snap(), task), /参考单集时长/);
  p.reference_episode_duration_seconds = 150;
  p.script.body = " ";
  assert.throws(() => precheck(snap(), task), /剧本为空/);
});

test("拆分与摘要模板：占位符齐全，摘要资料来自本集剧情", async () => {
  const p = scriptProject();
  p.episodes = buildSplit(script, { 剧集: rows }).episodes.map((e) => emptyEpisode(e));
  const split = { business_type: "script-split", target_id: p.id, action: "generate", opinion: "" };
  for (const suffix of ["generate", "regenerate"]) {
    const prompt = renderTaskPrompt({ project: p, steps: [] }, { ...split, opinion: "第二集再短一点" }, null, suffix);
    assert.ok(prompt.messages[1].content.includes("P001 第一场 酒馆"));
    assert.ok(prompt.user.includes("第二集再短一点"));
    if (suffix === "regenerate") assert.ok(prompt.messages[2].content.includes("P004"));
  }
  const first = renderTaskPrompt({ project: p, steps: [] }, { ...split, opinion: "" }, null, "generate");
  assert.equal(first.user.includes("修改意见"), false);
  const e = p.episodes[1],
    summary = renderTaskPrompt({ project: p, steps: [] }, { business_type: "episode-summary", target_id: e.id, action: "generate", opinion: "" }, null, "generate");
  assert.ok(summary.user.includes("武松打虎。"));
  assert.ok(!summary.user.includes("故事小段"));
});

test("剧本创作方式不能逐集新增；编辑剧情使展示摘要与故事大纲过期", async () => {
  const home = await mkdtemp(join(tmpdir(), "meiji-split-runtime-"));
  let runtime;
  try {
    runtime = await createAppRuntime({ home });
    const p = scriptProject(),
      e = emptyEpisode({ plot: script });
    e.summary = { node_state: { status: "generated", reason: "", dependency_hash: "" }, body: "摘要" };
    e.story_outline = { node_state: { status: "generated", reason: "", dependency_hash: "" }, segments: [{ sequence: 1, duration_seconds: 150, body: "故事", causal: "" }] };
    p.episodes = [e];
    const model = await runtime.repository.create(p),
      sid = `session-${randomUUID()}`;
    await runtime.bindings.bind(sid, p.id);
    await assert.rejects(
      runtime.projectCommand({ type: "add-episode", project_id: p.id, request_id: "add", fields: {} }, sid),
      /拆分剧集/,
    );
    await runtime.projectCommand(
      { type: "edit-episode", project_id: p.id, request_id: "plot", episode_id: e.id, fields: { plot: "改过的剧情" } },
      sid,
    );
    const after = model.read().project.episodes[0];
    assert.equal(after.plot, "改过的剧情");
    assert.equal(after.summary.node_state.status, "expired");
    assert.equal(after.story_outline.node_state.status, "expired");
    assert.equal(after.story_outline.segments[0].body, "故事");
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
    snap.project.creation_mode = "剧本";
    context.paint();
    assert.equal(root.querySelector("[aria-label=新增剧集]"), null);
    const episodeCard = [...root.querySelectorAll("section")].find((card) => card.querySelector("h3")?.textContent === "剧集");
    const opinion = episodeCard.querySelector("[aria-label=本次执行意见]");
    assert.equal(opinion.placeholder, "本次执行意见");
    opinion.value = "第二集再短一点";
    opinion.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    root.querySelector("[aria-label=重新生成]").click();
    const dialog = root.querySelector("dialog");
    assert.match(dialog.textContent, /参考单集时长（秒）/);
    dialog.querySelector("[name=reference_episode_duration_seconds]").value = "120";
    dialog.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(dialog.open, false);
    assert.equal(root.querySelector("dialog"), null);
    assert.equal(calls.length, 1, "时长请求未返回时弹框应已关闭，拆分尚未提交");
    releaseSave();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.map((c) => c.url), ["/api/meiji/project-command", "/api/meiji/task-command"]);
    assert.deepEqual(calls[0].body.command.fields, { reference_episode_duration_seconds: 120 });
    assert.equal(calls[1].body.command.business_type, "script-split");
    assert.equal(calls[1].body.command.action, "regenerate");
    assert.equal(calls[1].body.command.opinion, "第二集再短一点");
    for (const path of ["/api/meiji/project-command", "/api/meiji/task-command"]) {
      failPath = path;
      const before = calls.length;
      root.querySelector("[aria-label=重新生成]").click();
      root.querySelector("dialog form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      assert.equal(root.querySelector("dialog"), null);
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      const blocked = root.querySelector("dialog.blocking-reason");
      assert.match(blocked.textContent, /提交失败测试/);
      blocked.querySelector("button").click();
      assert.equal(root.querySelector("dialog"), null);
      assert.equal(calls.length - before, path.endsWith("project-command") ? 1 : 2);
    }
    assert.deepEqual(errors, ["提交失败测试", "提交失败测试"]);
    view.page = "episode";
    view.episode_id = snap.project.episodes[0].id;
    view.tab = "script";
    context.paint();
    assert.match(root.querySelector(".episode-plot").textContent, /本集剧情原文/);
    assert.match(root.querySelector("[data-business=outline]").textContent, /故事大纲/);
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});

for (const repairSucceeds of [true, false]) test(`拆分程序审核${repairSucceeds ? '修订通过后只完成拆分' : '耗尽保留历史候选且不覆盖旧剧集'}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-split-review-"));
  const project = scriptProject();
  project.episodes = [emptyEpisode({ plot: "旧正式剧情", duration_seconds: 150 })];
  const oldEpisodes = structuredClone(project.episodes);
  const repository = new ModelRepository(root), model = await repository.create(project);
  const badRows = structuredClone(rows);
  badRows[1].起始段落 = "P005";
  const prompts = [];
  let generations = 0;
  const text = createTextHandler({ chat: async ({ task, step, messages }) => {
    if (step.kind === "review") return { 是否通过: true, 原因: "" };
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
    assert.equal(task.business_type, "script-split", "拆分不应调用剧集摘要");
    prompts.push(prompt);
    generations++;
    return covered(repairSucceeds && generations > 1 ? rows : badRows);
  } });
  const service = new TaskService({ repository, commitOutput: commitContent, execute: createHandlerRegistry({ text, media: () => { throw Error("不应调用图片"); } }) });
  try {
    const result = await service.command({ type: "submit", project_id: project.id, request_id: "split-reviews", business_type: "script-split", target_id: project.id, action: "regenerate" });
    await service.idle(project.id);
    const snapshot = model.read(), task = snapshot.tasks.find(item => item.id === result.task_id);
    assert.equal(task.task_status, repairSucceeds ? "completed" : "rejected", task.end_reason);
    assert.equal(generations, repairSucceeds ? 2 : 3);
    const rejected = snapshot.steps.filter(item => item.task_id === task.id && item.step_status === "rejected");
    assert.ok(rejected.every(item => item.name.includes("程序审核") && item.error_reason.includes("遗漏")));
    assert.match(prompts[1], /P005/);
    assert.match(prompts[1], /段落有遗漏/);
    assert.ok(!Object.hasOwn(snapshot.project, "node_state"));
    if (repairSucceeds) {
      assert.equal(snapshot.project.episodes.map(episode => episode.plot).join(""), script);
      assert.equal(snapshot.tasks.filter(item => item.group_id === task.group_id).length, 1);
      assert.ok(snapshot.project.episodes.every(e => e.summary.body === "" && e.summary.node_state.status === "empty"));
    } else {
      assert.deepEqual(snapshot.project.episodes, oldEpisodes);
      assert.equal(snapshot.tasks.length, 1);
      const last = snapshot.steps.filter(item => item.task_id === task.id && item.kind === "revise").at(-1);
      assert.deepEqual(last.result, covered(badRows));
      const retried = await service.command({ type: "submit", project_id: project.id, request_id: "split-retry", business_type: "script-split", target_id: project.id, action: "regenerate" });
      await service.idle(project.id);
      const retryTask = model.read().tasks.find(item => item.id === retried.task_id);
      assert.match(retryTask.opinion, /段落有遗漏/);
      assert.match(prompts[3], /P005/);
      assert.match(prompts[3], /段落有遗漏/);
    }
  } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
});

test("拆分已经成功后带意见修改使用正式切点，不复用更早的拒绝候选", () => {
  const project = scriptProject();
  project.episodes = buildSplit(script, { 剧集: rows }).episodes.map(episode => emptyEpisode(episode));
  const snapshot = {
    project,
    tasks: [{ id: "old-rejected", business_type: "script-split", task_status: "rejected", queue_order: 1 }, { id: "latest-passed", business_type: "script-split", task_status: "completed", queue_order: 2 }],
    steps: [{ task_id: "old-rejected", kind: "revise", step_status: "done", seq: 5, result: { 剧集: [{ ...rows[0], 起始段落: "P999" }] } }],
  };
  const values = taskNodeInput(snapshot, { id: "new", business_type: "script-split", target_id: project.id, action: "regenerate", opinion: "调整切点" }, null, "regenerate");
  assert.deepEqual(values.content, covered(rows));
});

test('一次报告首部、中间、尾部全部遗漏以及重叠的期望编号', () => {
  const raw = { 剧集: [
    { 序号: 1, 起始段落: 'P002', 结束段落: 'P002', 预估时长秒: 10 },
    { 序号: 2, 起始段落: 'P004', 结束段落: 'P005', 预估时长秒: 20 },
  ] };
  const before = structuredClone(raw);
  assert.throws(() => buildSplit(script, raw), error => {
    assert.equal(error.code, 'INVALID_CONTRACT');
    for (const text of ['P001—P001', 'P003—P003', 'P006—P006', '起始段落应为P001', '起始段落应为P003', '结束段落应为P006']) assert.ok(error.message.includes(text), error.message);
    return true;
  });
  assert.deepEqual(raw, before, '审核不得自动修正候选');
  raw.剧集[1].起始段落 = 'P002';
  assert.throws(() => buildSplit(script, raw), error => /重叠或倒序.*应为P003/.test(error.message) && error.message.includes('P006—P006'));
});

test('全部覆盖问题进入同一轮修订，通过后逐字保存原文且保留审核历史', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-split-all-gaps-'));
  let runtime, calls = 0;
  try {
    runtime = await createAppRuntime({ home, gateway: { chat: async ({ messages, step }) => {
      if (step.kind === "review") return { 是否通过: true, 原因: "" };
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
      calls++;
      if (calls === 1) return covered([
        { 序号: 1, 起始段落: 'P002', 结束段落: 'P002', 预估时长秒: 10 },
        { 序号: 2, 起始段落: 'P004', 结束段落: 'P005', 预估时长秒: 20 },
      ]);
      for (const range of ['P001—P001', 'P003—P003', 'P006—P006']) assert.ok(prompt.includes(range), prompt);
      return covered(rows);
    } } });
    const project = scriptProject();
    project.episodes = [emptyEpisode({ plot: '原有剧情' })];
    const model = await runtime.repository.create(project);
    const result = await runtime.tasks.command({ type: 'submit', project_id: project.id, target_id: project.id, business_type: 'script-split', action: 'regenerate', request_id: randomUUID() });
    await runtime.tasks.idle(project.id);
    const snapshot = model.read();
    assert.equal(snapshot.tasks.find(t => t.id === result.task_id).task_status, 'completed');
    assert.equal(calls, 2);
    assert.equal(snapshot.project.episodes.map(e => e.plot).join(''), script);
    const review = snapshot.steps.find(s => s.kind === 'review' && s.round === 0);
    assert.equal(review.step_status, 'rejected');
    for (const range of ['P001—P001', 'P003—P003', 'P006—P006']) assert.ok(review.error_reason.includes(range));
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
});
