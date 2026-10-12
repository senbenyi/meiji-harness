import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel } from "../client/task-panel.js";
import { snapshotFixture } from "./fixtures/project.js";

test("任务生成按钮按内容和审核状态互斥，意见修改要求填写意见", async () => {
  const dom = new JSDOM("<main></main>"),
    previousDocument = globalThis.document,
    previousFetch = globalThis.fetch,
    commands = [];
  globalThis.document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  globalThis.fetch = async (_url, options) => {
    commands.push(JSON.parse(options.body).command);
    return { ok: true, json: async () => ({ accepted: true }) };
  };
  try {
    const snapshot = snapshotFixture(),
      root = document.querySelector("main"),
      episode = snapshot.project.剧集[0],
      view = { page: "episode", episode_id: episode.id, tab: "script" },
      context = {
        session_id: "session-test",
        view,
        refresh: async () => {},
        paint: () => {},
        onError: () => {},
      },
      summary = (状态, 正文 = "", 原因 = "") => ({ 状态, 原因, 正文, 剧本版本: 1 }),
      card = () => root.querySelector('[data-business="episode-summary"]'),
      actions = () => [...card().querySelectorAll(".workflow-generation-row button")]
        .map((button) => button.textContent)
        .filter((label) => ["AI生成", "重新生成", "按意见修改"].includes(label)),
      click = async (label) => {
        [...card().querySelectorAll("button")].find((button) => button.textContent === label).click();
        await new Promise((resolve) => setImmediate(resolve));
      };

    episode.摘要 = summary("empty");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["AI生成"]);
    await click("AI生成");
    assert.equal(commands.at(-1).action, "generate");
    assert.equal(commands.at(-1).opinion, undefined);

    episode.摘要 = summary("generated", "已通过的摘要");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["重新生成"]);
    await click("重新生成");
    assert.equal(commands.at(-1).action, "regenerate");
    assert.equal(commands.at(-1).opinion, undefined);
    assert.equal(root.querySelector("dialog"), null);

    episode.摘要 = summary("rejected", "未通过的摘要", "需要修订");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["重新生成", "按意见修改"]);
    await click("重新生成");
    assert.equal(commands.at(-1).action, "regenerate");
    assert.equal(commands.at(-1).opinion, undefined);

    [...card().querySelectorAll("button")].find((button) => button.textContent === "按意见修改").click();
    const dialog = root.querySelector("dialog"),
      form = dialog.querySelector("form"),
      opinion = dialog.querySelector('[aria-label="正文"]');
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(commands.at(-1).opinion, undefined);
    assert.equal(dialog.querySelector('[role="alert"]').textContent, "请输入修改意见");
    opinion.value = "保留人物关系，补足动机";
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(commands.at(-1).action, "regenerate");
    assert.equal(commands.at(-1).opinion, "保留人物关系，补足动机");

    episode.摘要 = summary("failed", "");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["AI生成"]);
    episode.摘要 = summary("expired", "过期内容");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["重新生成"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    dom.window.close();
  }
});
