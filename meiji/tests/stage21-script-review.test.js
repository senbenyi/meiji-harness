import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { JSDOM } from "jsdom";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { validateCommand } from "../shared/task_contract.js";
import { expireDownstream } from "../shared/node-dependencies.js";
import { emptyProject } from "../shared/project_contract.js";
import { renderTaskPanel } from "../client/task-panel.js";
import { approveScriptReview, snapshotFixture } from "./fixtures/project.js";

const script = "第一场 酒馆\n武松喝酒。\n第二场 景阳冈\n武松打虎。";
const fixed = "第一场 酒馆\n武松喝酒，决定连夜上冈。\n第二场 景阳冈\n武松打虎。";
const reason = "1. 第一场末补一句武松决定连夜上冈，使第二场有缘由。";
const pass = { 是否通过: true, 原因: "" }, reject = { 是否通过: false, 原因: reason };

async function withRuntime(reply, work) {
  const home = await mkdtemp(join(tmpdir(), "meiji-script-node-")), calls = [];
  let runtime;
  try {
    runtime = await createAppRuntime({
      home,
      sessionController: { create: async () => ({ sessionId: `session-${randomUUID()}` }), resolveAgent: async () => ({ agent: null }) },
      gateway: { chat: async ({ task, step, messages }) => { calls.push({ business: task.business_type, action: task.action, step: step.kind, messages }); return reply(step, calls); } },
    });
    await work(runtime, calls);
  } finally {
    await runtime?.dispose();
    await rm(home, { recursive: true, force: true });
  }
}
const create = runtime => runtime.projectCommand({ type: "create", fields: { name: "武松", creation_mode: "剧本", script: { body: script } } }, null);
const read = async (runtime, opened) => (await runtime.repository.open(opened.project_id)).read();
const run = async (runtime, opened, fields) => {
  const result = await runtime.command({ type: "submit", project_id: opened.project_id, request_id: randomUUID(), target_id: opened.project_id, action: "generate", ...fields }, opened.session_id);
  await runtime.tasks.idle(opened.project_id);
  return (await read(runtime, opened)).tasks.find(t => t.id === result.task_id);
};
const stepsOf = (s, task) => s.steps.filter(st => st.task_id === task.id).sort((a, b) => a.seq - b.seq).map(st => [st.kind, st.name, st.step_status]);

test("导入剧本自动审核剧本节点：只有前置检查与AI审核，通过后剧本节点已生成", () =>
  withRuntime(() => pass, async (runtime, calls) => {
    const opened = await create(runtime);
    await runtime.tasks.idle(opened.project_id);
    const s = await read(runtime, opened);
    const task = s.tasks.find(t => t.id === opened.script_review_task_id);
    assert.equal(task.business_type, "script-review");
    assert.equal(task.name, "审核剧本");
    assert.equal(task.task_status, "completed", task.end_reason);
    assert.deepEqual(stepsOf(s, task), [["precheck", "前置检查", "done"], ["review", "AI审核剧本", "done"]]);
    assert.equal(s.project.script.node_state.status, "generated");
    assert.equal(s.project.script.body, script);
    assert.equal(calls.length, 1);
    assert.match(JSON.stringify(calls[0].messages), /武松打虎/);
    assert.equal(precheck(s, { business_type: "script-split", target_id: s.project.id, action: "generate" }).passed, true);
  }));

test("审核未通过：剧本节点未通过、原因为修改意见，审核任务不自动修改；拦截提取剧集与人物，人工放行后解除", () =>
  withRuntime(() => reject, async (runtime, calls) => {
    const opened = await create(runtime);
    await runtime.tasks.idle(opened.project_id);
    let s = await read(runtime, opened);
    const task = s.tasks.find(t => t.id === opened.script_review_task_id);
    assert.equal(task.task_status, "rejected");
    assert.equal(task.end_reason, reason);
    assert.equal(calls.length, 1, "审核任务不修改剧本");
    assert.equal(s.project.script.node_state.status, "rejected");
    assert.equal(s.project.script.node_state.reason, reason);
    assert.equal(s.project.script.body, script);
    for (const business of ["script-split", "project-characters"]) {
      const blocked = await run(runtime, opened, { business_type: business });
      assert.equal(blocked.task_status, "rejected");
      assert.match(blocked.end_reason, /剧本审核未通过.*连夜上冈.*按审核意见修改，或人工放行/);
    }
    assert.equal(calls.length, 1, "被拦截的任务不调用模型");
    const again = await run(runtime, opened, { business_type: "script-review", action: "regenerate" });
    assert.equal(again.opinion, "", "重新审核不把旧修改意见当作审核要求");
    await runtime.command({ type: "override", project_id: opened.project_id, request_id: randomUUID(), business_type: "script-review", target_id: opened.project_id }, opened.session_id);
    await runtime.tasks.idle(opened.project_id);
    s = await read(runtime, opened);
    assert.equal(s.project.script.node_state.status, "generated");
    assert.equal(precheck(s, { business_type: "project-characters", target_id: s.project.id, action: "generate" }).passed, true);
  }));

test("修改：按审核意见改写剧本后再审核，通过则写入新剧本、版本递增并记录修改历史", () =>
  withRuntime((step, calls) => step.kind === "review" ? (calls.filter(c => c.step === "review").length === 1 ? reject : pass) : fixed,
    async (runtime, calls) => {
      const opened = await create(runtime);
      await runtime.tasks.idle(opened.project_id);
      const task = await run(runtime, opened, { business_type: "script-review", action: "revise", opinion: reason });
      const s = await read(runtime, opened);
      assert.equal(task.name, "按审核意见修改剧本");
      assert.equal(task.task_status, "completed", task.end_reason);
      assert.deepEqual(stepsOf(s, task).map(([kind, name]) => [kind, name]), [["precheck", "前置检查"], ["generate", "按审核意见修改剧本"], ["review", "AI审核剧本"]]);
      assert.equal(s.project.script.body, fixed);
      assert.equal(s.project.script.version, 2);
      assert.equal(s.project.script.revision_history.at(-1).task_id, task.id);
      assert.match(s.project.script.revision_history.at(-1).revision_notes, /连夜上冈/);
      assert.equal(s.project.script.node_state.status, "generated");
      const rewrite = calls.find(c => c.step === "generate").messages;
      assert.deepEqual(rewrite.map(m => m.role), ["system", "user", "assistant", "user"]);
      assert.equal(rewrite[2].content, script, "当前剧本作为基稿");
      assert.match(rewrite[3].content, /连夜上冈/, "修改意见在最后");
      assert.match(JSON.stringify(calls.at(-1).messages), /决定连夜上冈/, "审核的是修改后的剧本");
      assert.equal(precheck(s, { business_type: "script-split", target_id: s.project.id, action: "generate" }).passed, true);
    }));

test("修改与审核最多两轮：两轮仍未通过则保存最后一轮剧本、剧本节点未通过", () =>
  withRuntime((step, calls) => step.kind === "review" ? reject : `${fixed}\n第${calls.filter(c => c.step !== "review").length}稿`,
    async (runtime, calls) => {
      const opened = await create(runtime);
      await runtime.tasks.idle(opened.project_id);
      const task = await run(runtime, opened, { business_type: "script-review", action: "revise", opinion: reason });
      const s = await read(runtime, opened);
      assert.equal(task.task_status, "rejected");
      assert.deepEqual(stepsOf(s, task).map(([kind, name, status]) => [kind, name, status]), [
        ["precheck", "前置检查", "done"], ["generate", "按审核意见修改剧本", "done"], ["review", "AI审核剧本", "rejected"],
        ["revise", "第 1 轮修改剧本", "done"], ["review", "第 1 轮AI审核剧本", "rejected"]]);
      assert.equal(calls.filter(c => c.step !== "review").length, 2);
      assert.equal(s.project.script.body, `${fixed}\n第2稿`);
      assert.equal(s.project.script.node_state.status, "rejected");
      assert.equal(s.project.script.node_state.reason, reason);
    }));

test("剧本节点不接受人工编辑；按审核意见修改需要意见", () => {
  const base = { project_id: "p_" + randomUUID(), request_id: "x", business_type: "script-review", target_id: "p_" + randomUUID() };
  assert.throws(() => validateCommand({ ...base, type: "manual-edit", content: "新剧本" }), /剧本只支持/);
  assert.throws(() => validateCommand({ ...base, type: "submit", action: "revise" }), /修改意见/);
  assert.doesNotThrow(() => validateCommand({ ...base, type: "submit", action: "revise", opinion: reason }));
});

test("自由创作不提交剧本审核；剧本变化使剧本节点过期并拦截提取", () =>
  withRuntime(() => pass, async (runtime, calls) => {
    const opened = await runtime.projectCommand({ type: "create", fields: { name: "自由", creation_mode: "自由创作", creative_direction: "方向" } }, null);
    assert.equal(opened.script_review_task_id, undefined);
    assert.equal(calls.length, 0);
    const snapshot = snapshotFixture(), p = snapshot.project;
    p.script.body = "新剧本";
    expireDownstream(snapshot, "script", p.id, "剧本已修改");
    assert.equal(p.script.node_state.status, "expired");
    assert.throws(() => precheck(snapshot, { business_type: "script-split", target_id: p.id, action: "generate" }), /剧本已变化，请重新审核剧本/);
    approveScriptReview(p);
    assert.equal(precheck(snapshot, { business_type: "script-split", target_id: p.id, action: "generate" }).passed, true);
  }));

test("v15→v18：旧项目补剧本节点状态；v16 独立 script_review 并入剧本；v17 审核结论字段移除并保留状态", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-v18-"));
  try {
    let repo = new ModelRepository(root);
    const projects = ["v15", "v16", "v17"].map(name => { const p = emptyProject({ name, creation_mode: "剧本" }); p.script.body = script; return approveScriptReview(p); });
    for (const p of projects.slice(1)) Object.assign(p.script.node_state, { status: "rejected", reason });
    for (const p of projects) await repo.create(p);
    await repo.close();
    let db = new DatabaseSync(join(root, "meiji.sqlite"));
    const update = db.prepare("UPDATE projects SET data_json=? WHERE id=?");
    for (const row of db.prepare("SELECT id,data_json FROM projects").all()) {
      const project = JSON.parse(row.data_json), state = project.script.node_state, name = project.name;
      delete project.script.node_state;
      if (name === "v16") project.script_review = { node_state: state, has_result: true, suggestions: reason };
      if (name === "v17") project.script = { ...project.script, node_state: state, review: { has_result: true, suggestions: reason } };
      update.run(JSON.stringify(project), row.id);
    }
    db.exec("DELETE FROM schema_migrations WHERE version>=16; PRAGMA user_version=15");
    db.close();
    repo = new ModelRepository(root);
    const [v15, v16, v17] = await Promise.all(projects.map(async p => (await repo.open(p.id)).read().project));
    assert.equal(v15.script.node_state.status, "empty");
    for (const p of [v16, v17]) {
      assert.equal(p.script.node_state.status, "rejected");
      assert.equal(p.script.node_state.reason, reason);
      assert.match(p.script.node_state.dependency_hash, /^[a-f0-9]{64}$/);
    }
    for (const p of [v15, v16, v17]) {
      assert.equal("script_review" in p, false);
      assert.equal("review" in p.script, false);
      assert.equal(p.script.body, script);
    }
    await repo.close();
    db = new DatabaseSync(join(root, "meiji.sqlite"));
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 21);
    assert.deepEqual(db.prepare("SELECT version FROM schema_migrations WHERE version>=16 ORDER BY version").all().map(r => r.version), [16, 17, 18, 19, 20, 21]);
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

function paintOverview(mutate, sent = []) {
  const dom = new JSDOM("<main></main>", { url: "http://localhost" }), saved = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = dom.window.document;
  globalThis.fetch = async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; };
  const close = () => { Object.assign(globalThis, saved); dom.window.close(); };
  try {
    const snap = snapshotFixture(), root = document.querySelector("main");
    snap.project.creation_mode = "剧本";
    mutate?.(snap);
    renderTaskPanel(root, snap, { session_id: "s", view: { page: "overview" }, refresh: async () => {}, paint: () => {}, onError: () => {} });
    return { root, close };
  } catch (error) { close(); throw error; }
}

test("剧本卡片即剧本节点：无状态标签与版本、不展示审核结论；未通过时原因下方为「修改」「人工放行」按钮，点击修改按原因提交修改任务", async () => {
  const sent = [];
  const { root, close } = paintOverview(snap => Object.assign(snap.project.script.node_state, { status: "rejected", reason, dependency_hash: "" }), sent);
  try {
    assert.equal(root.querySelectorAll("[data-business=script-review]").length, 1);
    const card = root.querySelector("[data-business=script-review]");
    assert.ok(card.querySelector(".script-title-row"));
    assert.equal(card.querySelector(".node-data-tag"), null);
    assert.doesNotMatch(card.textContent, /版本|剧情连续|适合拍摄/);
    // 「查看规则」由其他功能统一追加，不在本断言范围内。
    assert.deepEqual([...card.querySelectorAll(".node-ui > .workflow-generation-row button")].map(b => b.textContent).filter(t => t !== "查看规则"), ["重新审核", "任务历史"]);
    const ui = card.querySelector(".node-ui"), children = [...ui.children];
    const reasonRow = ui.querySelector(".node-ui-reason"), repairRow = ui.querySelector(".node-ui-repair-row");
    assert.match(reasonRow.textContent, /未通过原因：1\. 第一场末补一句/);
    assert.equal(children.indexOf(repairRow), children.indexOf(reasonRow) + 1, "修改按钮在原因下方");
    assert.deepEqual([...repairRow.querySelectorAll("button")].map(b => b.textContent), ["修改（再给 1 轮）", "人工放行"]);
    repairRow.querySelector("button").click();
    await new Promise(r => setTimeout(r, 0));
    const command = sent.at(-1).command;
    assert.deepEqual({ type: command.type, business_type: command.business_type, action: command.action, opinion: command.opinion },
      { type: "submit", business_type: "script-review", action: "revise", opinion: reason });
  } finally { close(); }
  const empty = paintOverview(snap => { snap.project.script.node_state.status = "empty"; });
  try {
    const card = empty.root.querySelector("[data-business=script-review]");
    assert.deepEqual([...card.querySelectorAll("button")].filter(b => !b.classList.contains("script-file-name") && !["→", "查看规则"].includes(b.textContent)).map(b => b.textContent), ["AI审核", "任务历史"]);
    assert.equal(card.querySelector(".node-ui-repair-row"), null);
  } finally { empty.close(); }
});

test("修改进行中：剧本卡片状态行标明修改流程与当前步骤，隐藏修改与审核按钮，保留取消", () => {
  const { root, close } = paintOverview(snap => {
    Object.assign(snap.project.script.node_state, { status: "rejected", reason, dependency_hash: "" });
    snap.groups = [{ id: "g", group_type: "single" }];
    snap.tasks = [{ id: "t1", name: "按审核意见修改剧本", group_id: "g", group_seq: 1, business_type: "script-review", target_id: snap.project.id, action: "revise", task_status: "running", queue_order: 1, end_reason: "", opinion: reason }];
    snap.steps = [
      { id: "s1", task_id: "t1", seq: 1, kind: "precheck", name: "前置检查", step_status: "done" },
      { id: "s2", task_id: "t1", seq: 2, kind: "generate", name: "按审核意见修改剧本", step_status: "done" },
      { id: "s3", task_id: "t1", seq: 3, kind: "review", name: "AI审核剧本", step_status: "rejected" },
      { id: "s4", task_id: "t1", seq: 4, kind: "revise", name: "第 1 轮修改剧本", step_status: "running" },
      { id: "s5", task_id: "t1", seq: 5, kind: "review", name: "第 1 轮AI审核剧本", step_status: "ready" },
    ];
  });
  try {
    const card = root.querySelector("[data-business=script-review]");
    assert.equal(card.querySelector(".node-ui-task-status").textContent, "最新任务：生成中 · 按审核意见修改剧本 · 当前：第 1 轮修改剧本 · 自动修订 1/1");
    const labels = [...card.querySelectorAll(".node-ui button")].map(b => b.textContent);
    assert.ok(labels.includes("取消"));
    for (const hidden of ["修改", "重新审核", "人工放行"]) assert.ok(!labels.includes(hidden), hidden);
  } finally { close(); }
});
