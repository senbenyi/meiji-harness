import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel, episodeTabs } from "../client/task-panel.js";
import { PanelContext } from "../client/task-client.js";
import { snapshotFixture } from "./fixtures/project.js";

test("剧集横向鼠标拖动、松开与取消，拖动不打开剧集，点击/键盘与触摸保持可用", () => {
  const dom = new JSDOM('<main></main>'), previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(), root = document.querySelector('main'), view = { page: 'overview' };
    renderTaskPanel(root, snapshot, { session_id: 'session-test', view, refresh: async () => {}, paint: () => {}, onError: () => {} });
    const list = root.querySelector('.episode-card-list'), card = list.querySelector('.episode-card');
    Object.defineProperties(list, { scrollWidth: { value: 900 }, clientWidth: { value: 300 } });
    let captured = null;
    list.setPointerCapture = id => { captured = id; };
    list.hasPointerCapture = id => captured === id;
    list.releasePointerCapture = () => { captured = null; };
    const pointer = (type, x, pointerType = 'mouse') => {
      const event = new dom.window.MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
      card.dispatchEvent(event); return event;
    };
    pointer('pointerdown', 200); pointer('pointermove', 120);
    assert.equal(list.scrollLeft, 80); assert.equal(captured, 1); assert.ok(list.classList.contains('is-dragging'));
    pointer('pointerup', 120); card.click();
    assert.equal(view.page, 'overview'); assert.equal(captured, null); assert.ok(!list.classList.contains('is-dragging'));
    pointer('pointermove', 80); assert.equal(list.scrollLeft, 80);
    pointer('pointerdown', 120); pointer('pointermove', 160); pointer('pointercancel', 160);
    assert.equal(list.scrollLeft, 40); assert.equal(captured, null);
    pointer('pointerdown', 100); pointer('pointermove', 103); pointer('pointerup', 103); card.click();
    assert.equal(view.page, 'episode'); assert.equal(list.scrollLeft, 40);
    view.page = 'overview';
    card.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(view.page, 'episode');
    view.page = 'overview';
    pointer('pointerdown', 200, 'touch'); const touchMove = pointer('pointermove', 100, 'touch');
    assert.equal(list.scrollLeft, 40); assert.equal(touchMove.defaultPrevented, false);
  } finally { globalThis.document = previous; dom.window.close(); }
});

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
test("S7-07 实际 DOM 保留页面与四标签，状态/原因直读，运行中冻结编辑且允许取消", () => {
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
    assert.deepEqual(episodeTabs.map((x) => x[1]), ["剧情", "镜头表", "成片", "合成"]);
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
    const episode = snapshot.project.剧集[0];
    episode.镜头表.状态 = "failed";
    episode.镜头表.原因 = "镜头表：镜头总时长超出允许范围（本集参考时长±30秒，允许 1–40 秒）";
    episode.镜头表.镜头[0].正文 = "最终超时生成镜头内容";
    view.tab = "shots";
    renderTaskPanel(root, snapshot, context);
    assert.ok(root.querySelector('[data-business="shots"]'));
    assert.ok(!root.querySelector('[data-business="episode-characters"]'));
    assert.ok(root.textContent.includes("失败"));
    assert.ok(root.textContent.includes(episode.镜头表.原因));
    assert.ok(root.textContent.includes("最终超时生成镜头内容"));
    const shotCard = root.querySelector('[data-business="shots"]'),
      title = shotCard.querySelector(".section-head"),
      actions = shotCard.querySelector(".workflow-generation-row");
    assert.equal(title.nextElementSibling, actions);
    assert.ok(
      [...actions.querySelectorAll("button")].some(
        (button) => button.textContent === "重新生成",
      ),
    );
    assert.ok(
      [...actions.querySelectorAll("button")].some(
        (button) => button.textContent === "任务历史",
      ),
    );
    view.tab = "assets";
    renderTaskPanel(root, snapshot, context);
    assert.equal(view.tab, "script");
    assert.ok(root.querySelector('[data-business="outline"]'));
    assert.ok(!root.querySelector('[data-business="episode-characters"]'));
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
    t.group_id = "g-test"; t.group_seq = 1;
    snapshot.groups = [{ id: t.group_id, group_type: "single" }];
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

test("故事大纲按小段各占一行", () => {
  const dom = new JSDOM("<main></main>"),
    previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(),
      episode = snapshot.project.剧集[0],
      root = document.querySelector("main");
    episode.故事大纲.小段 = [
      { 序号: 2, 时长秒: 6, 正文: "武松上路" },
      { 序号: 1, 时长秒: 4, 正文: "酒馆开场" },
    ];
    renderTaskPanel(root, snapshot, {
      session_id: "session-test",
      view: { page: "episode", episode_id: episode.id, tab: "script" },
      refresh: async () => {},
      paint: () => {},
      onError: () => {},
    });
    const lines = [
      ...root.querySelectorAll("[data-business=outline] .outline-segments p"),
    ].map((node) => node.textContent);
    assert.deepEqual(lines, ["1. 4秒 酒馆开场", "2. 6秒 武松上路"]);
    episode.故事大纲.状态 = "running";
    episode.摘要.状态 = "empty";
    renderTaskPanel(root, snapshot, {
      session_id: "session-test",
      view: { page: "episode", episode_id: episode.id, tab: "script" },
      refresh: async () => {},
      paint: () => {},
      onError: () => {},
    });
    const cards = [
      ...root.querySelectorAll(".session-project"),
    ].filter((card) =>
      ["outline", "episode-summary", ""].includes(card.dataset.business || "") &&
      (card.dataset.business || card.classList.contains("episode-plot")),
    );
    assert.deepEqual(
      cards.map((card) => card.querySelector("h3").textContent),
      ["故事大纲", "本集摘要", "本集剧情"],
    );
    assert.equal(
      cards[0].querySelector(".section-titles .status-label").textContent,
      "生成中",
    );
    assert.equal(
      cards[1].querySelector(".section-titles .status-label").textContent,
      "未生成",
    );
    assert.equal(cards[2].querySelector(".status-label"), null);
    assert.match(cards[2].textContent, /本集剧情原文/);
    assert.ok(
      [...cards[2].querySelectorAll("button")].some(
        (button) => button.textContent === "编辑剧情",
      ),
    );
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

test("项目详情四张卡片标题旁有状态，生成按钮按内容显示", () => {
  const dom = new JSDOM("<main></main>"),
    previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(),
      root = document.querySelector("main"),
      project = snapshot.project,
      cardOf = (title) =>
        [...root.querySelectorAll(".overview-card")].find(
          (card) => card.querySelector("h3")?.textContent === title,
        ),
      labelsOf = (card) =>
        [...card.querySelectorAll(".overview-title-actions button, .workflow-generation-row button")].map(
          (button) => button.textContent,
        );
    const paint = () =>
      renderTaskPanel(root, snapshot, {
        session_id: "session-test",
        view: { page: "overview" },
        refresh: async () => {},
        paint: () => {},
        onError: () => {},
      });
    paint();
    const outline = root.querySelector("[data-business=project-summary]");
    assert.equal(outline.querySelector(".section-titles h3").textContent, "项目大纲");
    assert.equal(outline.querySelector(".section-titles .status-label").textContent, "已生成");
    assert.deepEqual(
      labelsOf(outline).filter((label) => ["AI生成", "重新生成", "按意见修改"].includes(label)),
      ["重新生成"],
    );
    assert.deepEqual(
      labelsOf(cardOf("剧本")).filter((label) => ["AI生成", "重新生成", "按意见修改"].includes(label)),
      ["重新生成"],
    );
    assert.equal(cardOf("剧本").querySelector(".status-label"), null);
    assert.equal(cardOf("角色卡").querySelector(".section-titles .status-label").textContent, "未生成");
    assert.deepEqual(labelsOf(cardOf("角色卡")), ["提取角色"]);
    assert.ok(cardOf("剧集").querySelector("[aria-label=新增剧集]"));
    assert.ok(![...root.querySelectorAll("button")].some((button) => button.textContent.includes("添加角色")));
    project.创作方式 = "剧本";
    snapshot.tasks = [{
      id: "split",
      business_type: "script-split",
      target_id: project.id,
      task_status: "running",
      queue_order: 1,
      group_id: "g",
    }];
    snapshot.groups = [{ id: "g", group_type: "single" }];
    paint();
    assert.equal(cardOf("剧集").querySelector(".section-titles .status-label").textContent, "生成中");
    assert.equal(
      cardOf("剧集").querySelector(".overview-title-actions [aria-label=重新拆分剧集]").parentElement.className,
      "overview-title-actions",
    );
    assert.deepEqual(labelsOf(cardOf("剧本")), []);
    project.创作方式 = "自由创作";
    project.项目摘要.状态 = "rejected";
    project.角色库.状态 = "rejected";
    project.角色库.原因 = "未通过";
    project.角色库.角色 = [{ id: "c1", 编号: "C01", 名称: "武松", 身份: "好汉", 图片: { 地址: "" } }];
    snapshot.tasks = [{
      id: "script-task",
      business_type: "script",
      target_id: project.id,
      task_status: "rejected",
      queue_order: 2,
      group_id: "g2",
    }];
    snapshot.groups = [{ id: "g2", group_type: "single" }];
    paint();
    assert.equal(
      root.querySelector("[data-business=project-summary] .section-titles .status-label").textContent,
      "未通过",
    );
    assert.deepEqual(
      labelsOf(cardOf("项目大纲")).filter((label) => ["重新生成", "按意见修改"].includes(label)),
      ["重新生成", "按意见修改"],
    );
    assert.equal(cardOf("剧本").querySelector(".status-label").textContent, "未通过");
    assert.deepEqual(
      labelsOf(cardOf("剧本")).filter((label) => ["重新生成", "按意见修改"].includes(label)),
      ["重新生成", "按意见修改"],
    );
    assert.equal(cardOf("角色卡").querySelector(".status-label").textContent, "未通过");
    assert.deepEqual(labelsOf(cardOf("角色卡")), ["重新生成", "按意见修改"]);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});
