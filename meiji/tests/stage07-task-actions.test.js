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
      episode = snapshot.project.episodes[0],
      view = { page: "episode", episode_id: episode.id, tab: "script" },
      context = {
        session_id: "session-test",
        view,
        refresh: async () => {},
        paint: () => {},
        onError: () => {},
      },
      summary = (status, body = "", reason = "") => ({ node_state: { status, reason, dependency_hash: "" }, body }),
      card = () => root.querySelector('[data-business="episode-summary"]'),
      actions = () => [...card().querySelectorAll(".workflow-generation-row button")]
        .map((button) => button.textContent)
        .filter((label) => ["AI生成", "重新生成", "原结果修订"].includes(label)),
      click = async (label) => {
        [...card().querySelectorAll("button")].find((button) => button.textContent === label).click();
        await new Promise((resolve) => setImmediate(resolve));
      };

    episode.summary = summary("empty");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["AI生成"]);
    await click("AI生成");
    assert.equal(commands.at(-1).action, "generate");
    assert.equal(commands.at(-1).opinion, undefined);

    episode.summary = summary("generated", "已通过的摘要");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["重新生成", "原结果修订"]);
    await click("重新生成");
    assert.equal(commands.at(-1).action, "regenerate");
    assert.equal(commands.at(-1).opinion, undefined);
    assert.equal(root.querySelector("dialog"), null);

    episode.summary = summary("rejected", "未通过的摘要", "需要修订");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["重新生成", "原结果修订"]);
    await click("重新生成");
    assert.equal(commands.at(-1).action, "regenerate");
    assert.equal(commands.at(-1).opinion, undefined);

    [...card().querySelectorAll("button")].find((button) => button.textContent === "原结果修订").click();
    const dialog = root.querySelector("dialog"),
      form = dialog.querySelector("form"),
      opinion = dialog.querySelector('[aria-label="正文"]');
    assert.equal(opinion.value, "需要修订");
    opinion.value = "";
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(commands.at(-1).opinion, undefined);
    assert.equal(dialog.querySelector('[role="alert"]').textContent, "请输入修改意见");
    opinion.value = "保留人物关系，补足动机";
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(commands.at(-1).action, "revise");
    assert.equal(commands.at(-1).opinion, "保留人物关系，补足动机");

    for (const status of ["generated", "failed", "cancelled", "expired"]) {
      episode.summary = summary(status, "已有结果");
      renderTaskPanel(root, snapshot, context);
      assert.deepEqual(actions(), ["重新生成", "原结果修订"], status);
    }
    episode.summary = summary("running", "已有结果");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), []);
    episode.summary = summary("generated", "已有结果");
    snapshot.tasks = [{ business_type: "episode-summary", target_id: episode.id, task_status: "queued" }];
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), []);
    snapshot.tasks = [];

    episode.summary = summary("failed", "");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["AI生成"]);
    episode.summary = summary("expired", "过期内容");
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(actions(), ["重新生成", "原结果修订"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    dom.window.close();
  }
});

test('三个生成入口均携带公共输入框的本次执行意见', async () => {
  const dom = new JSDOM('<main></main>'), previous = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  const commands = [];
  globalThis.fetch = async (_url, options) => { commands.push(JSON.parse(options.body).command); return { ok: true, json: async () => ({}) }; };
  try {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0], root = document.querySelector('main');
    const context = { session_id: 'session-test', view: { page: 'episode', episode_id: episode.id, tab: 'script' }, refresh: async () => {}, paint: () => {}, onError: error => { throw error; } };
    for (const [label, action] of [['AI生成', 'generate'], ['重新生成', 'regenerate'], ['原结果修订', 'revise']]) {
      episode.summary.body = action === 'generate' ? '' : '上次摘要';
      episode.summary.node_state.status = action === 'generate' ? 'empty' : 'rejected';
      episode.summary.node_state.reason = action === 'generate' ? '' : '未通过原因';
      renderTaskPanel(root, snapshot, context);
      const card = root.querySelector('[data-business="episode-summary"]'), input = card.querySelector('.node-ui-opinion');
      input.value = '公共框本次执行意见';
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      [...card.querySelectorAll('button')].find(button => button.textContent === label).click();
      if (action === 'revise') {
        const dialog = root.querySelector('dialog');
        assert.match(dialog.textContent, /原结果修订/);
        dialog.querySelector('[aria-label="正文"]').value = '弹窗补充意见';
        dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(commands.at(-1).action, action);
      assert.match(commands.at(-1).opinion, /公共框本次执行意见/);
      if (action === 'revise') assert.match(commands.at(-1).opinion, /弹窗补充意见/);
    }
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
});
