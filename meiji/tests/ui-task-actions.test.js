import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel } from "../client/task-panel.js";
import { snapshotFixture } from "./fixtures/project.js";

describe("blocked-action-dialog", () => {
  function setup(snapshot, onError = () => {}, refresh = async () => {}) {
    const dom = new JSDOM("<main></main>"),
      previousDocument = globalThis.document,
      root = dom.window.document.querySelector("main"),
      episode = snapshot.project.episodes[0],
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
      name: "第 1 集 · 生成分集改编",
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
      assert.match(dialog.textContent, /第 1 集 · 生成分集改编/);
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
});

describe("task-actions", () => {
  test("任务生成按钮按内容和审核状态互斥，修复直接提交未通过原因", async () => {
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
      assert.deepEqual(actions(), ["重新生成"]);
      await click("重新生成");
      assert.equal(commands.at(-1).action, "regenerate");
      assert.equal(commands.at(-1).opinion, undefined);

      await click("修复（再给 3 轮）");
      assert.equal(root.querySelector("dialog"), null);
      assert.equal(commands.at(-1).action, "revise");
      assert.equal(commands.at(-1).opinion, "需要修订");

      for (const status of ["generated", "expired"]) {
        episode.summary = summary(status, "已有结果");
        renderTaskPanel(root, snapshot, context);
        assert.deepEqual(actions(), ["重新生成", "原结果修订"], status);
      }
      snapshot.tasks = [{ business_type: "episode-summary", target_id: episode.id, task_status: "running" }];
      episode.summary = summary("generated", "已有结果");
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
      for (const [label, action] of [['AI生成', 'generate'], ['重新生成', 'regenerate'], ['修复（再给 3 轮）', 'revise']]) {
        episode.summary.body = action === 'generate' ? '' : '上次摘要';
        episode.summary.node_state.status = action === 'generate' ? 'empty' : 'rejected';
        episode.summary.node_state.reason = action === 'generate' ? '' : '未通过原因';
        renderTaskPanel(root, snapshot, context);
        const card = root.querySelector('[data-business="episode-summary"]'), input = card.querySelector('.node-ui-opinion');
        input.value = '公共框本次执行意见';
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        [...card.querySelectorAll('button')].find(button => button.textContent === label).click();
        if (action === 'revise') {
          assert.equal(root.querySelector('dialog'), null);
        }
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(commands.at(-1).action, action);
        assert.match(commands.at(-1).opinion, /公共框本次执行意见/);
        if (action === 'revise') assert.match(commands.at(-1).opinion, /未通过原因/);
      }
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
  });
});

describe("split-feedback", () => {
  for (const status of ['queued', 'running', 'failed', 'completed', 'cancelled', 'superseded']) {
    test(`拆分任务${status}在标题操作区并列显示操作且进入最新任务`, () => {
      const dom = new JSDOM('<main></main>'), previous = globalThis.document;
      try {
        globalThis.document = dom.window.document;
        const s = snapshotFixture(), root = document.querySelector('main');
        s.project.creation_mode = '剧本';
        s.tasks = [
          { id: 'old', business_type: 'script-split', target_id: s.project.id, task_status: 'failed', end_reason: '旧错误', queue_order: 1 },
          { id: 'new', business_type: 'script-split', target_id: s.project.id, task_status: status, end_reason: status === 'failed' ? '模型没有返回有效JSON' : '', queue_order: 2 },
        ];
        const view = { page: 'overview' }, context = { session_id: 'session-test', view, refresh: async () => {}, paint: () => {}, onError: () => {} };
        renderTaskPanel(root, s, context);
        const card = [...root.querySelectorAll('section')].find((item) => item.querySelector('h3')?.textContent === '剧集');
        const actions = card.querySelector('.node-ui .workflow-generation-row');
        assert.ok(actions);
        assert.equal(card.querySelector('.episode-head'), null);
        assert.deepEqual([...actions.children].map((node) => node.className), ['node-ui-buttons', 'node-ui-task-status']);
        assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.textContent), ['queued', 'running'].includes(status) ? ['任务历史', '取消', '查看规则'] : ['重新生成', '任务历史', '查看规则']);
        const notice = card.querySelector('.node-ui .error');
        if (status === 'failed') {
          assert.equal(card.querySelector('.node-ui-task-status').textContent, '最新任务：失败');
          assert.equal(card.querySelector('.node-ui-opinion').nextElementSibling, notice);
          assert.match(notice.textContent, /模型没有返回有效JSON/);
          assert.doesNotMatch(notice.textContent, /旧错误/);
        } else {
          assert.equal(notice, null);
        }
        [...actions.querySelectorAll('button')].find((button) => button.textContent === '任务历史').click();
        assert.equal(view.page, 'history');
        assert.equal(view.task_id, 'new');
        assert.equal(card.querySelector('.node-ui-repair-row'), null);
      } finally {
        globalThis.document = previous;
        dom.window.close();
      }
    });
  }

  test('拆分未通过时原因下方修复直接修订候选，不弹框', async () => {
    const dom = new JSDOM('<main></main>');
    const previous = { document: globalThis.document, fetch: globalThis.fetch };
    globalThis.document = dom.window.document;
    dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
    const commands = [];
    globalThis.fetch = async (_url, options) => {
      commands.push(JSON.parse(options.body).command);
      return { ok: true, json: async () => ({ accepted: true }) };
    };
    try {
      const s = snapshotFixture(), root = document.querySelector('main');
      s.project.creation_mode = '剧本';
      s.project.episodes = [];
      const reason = '第1集超过容量上限';
      s.tasks = [{ id: 'split-rejected', business_type: 'script-split', target_id: s.project.id, task_status: 'rejected', end_reason: reason, queue_order: 1 }];
      s.steps = [{ id: 'review', task_id: 'split-rejected', seq: 2, kind: 'review', step_status: 'rejected', result: { 是否通过: false, 类型: '模型问题', 原因: reason } }];
      const view = { page: 'overview' };
      renderTaskPanel(root, s, { session_id: 'session-test', view, refresh: async () => {}, paint: () => {}, onError: (message) => { throw new Error(message); } });
      const card = [...root.querySelectorAll('section')].find((item) => item.querySelector('h3')?.textContent === '剧集');
      const ui = card.querySelector('.node-ui');
      assert.deepEqual([...ui.querySelector('.workflow-generation-row').querySelectorAll('button')].map((button) => button.textContent), ['AI生成', '人工放行', '任务历史', '查看规则']);
      const notice = ui.querySelector('.node-ui-opinion').nextElementSibling;
      assert.equal(notice.textContent, `未通过原因（模型问题）：${reason}`);
      const repair = notice.nextElementSibling;
      assert.equal(repair.className, 'node-ui-buttons node-ui-repair-row');
      assert.equal(repair.querySelector('button').textContent, '修复（再给 3 轮）');
      ui.querySelector('.workflow-generation-row button').nextElementSibling.click();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(commands.at(-1).type, 'override');
      assert.equal(commands.at(-1).business_type, 'script-split');
      ui.querySelector('.node-ui-opinion').value = '再提前一集';
      ui.querySelector('.node-ui-opinion').dispatchEvent(new dom.window.Event('input'));
      repair.querySelector('button').click();
      assert.equal(root.querySelector('dialog'), null);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(commands.at(-1).business_type, 'script-split');
      assert.equal(commands.at(-1).action, 'revise');
      assert.equal(commands.at(-1).target_id, s.project.id);
      assert.equal(commands.at(-1).opinion, `${reason}\n再提前一集`);
    } finally {
      globalThis.document = previous.document;
      globalThis.fetch = previous.fetch;
      dom.window.close();
    }
  });
});
