import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel, episodeTabs } from "../client/task-panel.js";
import { PanelContext } from "../client/task-client.js";
import { snapshotFixture } from "./fixtures/project.js";

test("S7-03/06 会话、项目与版本守卫拒绝晚到/乱序响应", () => {
  const context = new PanelContext(),
    a = snapshotFixture(),
    b = snapshotFixture(),
    first = context.select("session-a", a.project.id);
  assert.equal(context.accept(first, a), true);
  const second = context.select("session-b", b.project.id);
  assert.equal(context.accept(first, a), false);
  assert.equal(context.accept(second, b), true);
  const older = structuredClone(b);
  older.runtime.revision = 0;
  assert.equal(context.accept(second, older), false);
  assert.equal(context.read().project.id, b.project.id);
});
test("S7-07 实际 DOM 保留页面与六标签，状态/原因直读，运行中冻结编辑且允许取消", () => {
  const dom = new JSDOM('<main id="root"></main>');
  const oldDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const root = document.querySelector("main"),
      snapshot = snapshotFixture(),
      view = {
        page: "episode",
        episode_id: snapshot.project.剧集[0].id,
        tab: "film",
      },
      context = {
        session_id: "session-test",
        view,
        refresh: async () => {},
        paint: () => {},
        onError: () => {},
      };
    renderTaskPanel(root, snapshot, context);
    assert.deepEqual(
      [...root.querySelectorAll('[aria-label="剧集制作"] [role="tab"]')].map(
        (n) => n.textContent,
      ),
      episodeTabs.map((x) => x[1]),
    );
    assert.ok(root.textContent.includes("文本提示词"));
    assert.ok(root.textContent.includes("尾帧"));
    assert.ok(
      [...root.querySelectorAll("button")]
        .filter((b) => b.textContent === "AI生成")
        .every((b) => !b.disabled),
    );
    assert.ok(!root.textContent.includes("场景"));
    assert.ok(!root.textContent.includes("道具"));
    assert.ok(!root.textContent.includes("生成要求"));
    view.page = "settings";
    renderTaskPanel(root, snapshot, context);
    assert.ok(root.textContent.includes("规则"));
    assert.ok(!root.textContent.includes("技能库"));
    const t = {
      id: "t-test",
      business_type: "video",
      target_id: snapshot.project.剧集[0].镜头表.镜头[0].id,
      task_status: "running",
      queue_order: 1,
      end_reason: "",
    };
    snapshot.tasks = [t];
    view.page = "episode";
    renderTaskPanel(root, snapshot, context);
    assert.ok(
      [...root.querySelectorAll("button")]
        .filter((b) => b.textContent === "AI生成")
        .every((b) => b.disabled),
    );
    view.page = "history";
    renderTaskPanel(root, snapshot, context);
    const cancel = [...root.querySelectorAll("button")].find(
      (b) => b.textContent === "取消",
    );
    assert.equal(cancel.disabled, false);
  } finally {
    globalThis.document = oldDocument;
    dom.window.close();
  }
});
