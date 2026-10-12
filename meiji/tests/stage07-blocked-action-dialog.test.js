import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel } from "../client/task-panel.js";
import { snapshotFixture } from "./fixtures/project.js";

function setup(snapshot, onError = () => {}, refresh = async () => {}) {
  const dom = new JSDOM("<main></main>"),
    previousDocument = globalThis.document,
    root = dom.window.document.querySelector("main"),
    episode = snapshot.project.剧集[0],
    view = { page: "episode", episode_id: episode.id, tab: "shots" };
  dom.window.HTMLDialogElement.prototype.show = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  globalThis.document = dom.window.document;
  renderTaskPanel(root, snapshot, {
    session_id: "session-test",
    view,
    refresh,
    paint: () => {},
    onError,
  });
  return {
    dom,
    root,
    button: [...root.querySelectorAll('[data-business="shots"] button')].find((item) =>
      ["AI生成", "重新生成"].includes(item.textContent),
    ),
    cleanup() {
      globalThis.document = previousDocument;
      dom.window.close();
    },
  };
}

test("任务运行中点击生成按钮弹出阻塞任务原因且不发请求", () => {
  const snapshot = snapshotFixture();
  snapshot.tasks = [{
    id: "t-running",
    name: "第 1 集 · 生成故事大纲",
    business_type: "outline",
    task_status: "running",
  }];
  const ui = setup(snapshot);
  try {
    assert.ok(ui.button);
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.button.getAttribute("aria-disabled"), "true");
    ui.button.click();
    const dialog = ui.root.querySelector("dialog.blocking-reason");
    assert.ok(dialog?.open);
    assert.match(dialog.textContent, /第 1 集 · 生成故事大纲/);
    assert.match(dialog.textContent, /等待它结束后再试/);
  } finally {
    ui.cleanup();
  }
});

test("服务端拒绝按钮操作时弹框展示具体原因", async () => {
  const snapshot = snapshotFixture(),
    previousFetch = globalThis.fetch,
    ui = setup(snapshot);
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ message: "存在其他运行任务，请等待完成" }),
  });
  try {
    ui.button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dialog = ui.root.querySelector("dialog.blocking-reason");
    assert.ok(dialog?.open);
    assert.match(dialog.textContent, /存在其他运行任务，请等待完成/);
  } finally {
    globalThis.fetch = previousFetch;
    ui.cleanup();
  }
});

test("无阻塞且服务端受理时仍正常提交并刷新面板", async () => {
  const snapshot = snapshotFixture(),
    previousFetch = globalThis.fetch;
  let requests = 0, refreshes = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.equal(JSON.parse(options.body).command.business_type, "shots");
    return { ok: true, json: async () => ({ task_id: "t-accepted" }) };
  };
  const ui = setup(snapshot, () => {}, async () => refreshes++);
  try {
    assert.equal(ui.button.getAttribute("aria-disabled"), null);
    ui.button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests, 1);
    assert.equal(refreshes, 1);
    assert.equal(ui.root.querySelector("dialog.blocking-reason"), null);
  } finally {
    globalThis.fetch = previousFetch;
    ui.cleanup();
  }
});
