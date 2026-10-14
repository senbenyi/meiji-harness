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
        episode_id: snapshot.project.episodes[0].id,
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
    assert.equal(
      [...root.querySelectorAll("button")].some((button) => button.textContent === "编辑时长"),
      false,
    );
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
    const episode = snapshot.project.episodes[0];
    episode.shot_list.node_state.status = "failed";
    episode.shot_list.node_state.reason = "";
    episode.shot_list.node_state.fail_message = "镜头表：镜头总时长超出允许范围（本集参考时长±30秒，允许 1–40 秒）";
    episode.shot_list.shots[0].body = "最终超时生成镜头内容";
    view.tab = "shots";
    renderTaskPanel(root, snapshot, context);
    assert.ok(root.querySelector('[data-business="shots"]'));
    assert.ok(!root.querySelector('[data-business="episode-characters"]'));
    assert.ok(root.textContent.includes("失败"));
    assert.ok(root.textContent.includes(episode.shot_list.node_state.fail_message));
    assert.ok(root.textContent.includes("最终超时生成镜头内容"));
    const shotCard = root.querySelector('[data-business="shots"]'),
      title = shotCard.querySelector(".section-head"),
      ui = shotCard.querySelector(".node-ui"),
      actions = ui.querySelector(".workflow-generation-row");
    assert.equal(title.nextElementSibling, ui);
    assert.equal(ui.querySelector(".node-ui-status").parentElement, actions);
    assert.equal(ui.querySelector(".node-ui-status").textContent, "失败");
    assert.equal(title.querySelector(".status-label"), null);
    assert.equal(ui.querySelector(".node-ui-opinion").placeholder, "本次执行意见");
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
    assert.ok(!root.textContent.includes("编辑规则"));
    assert.ok(!root.textContent.includes(snapshot.project.name));
    assert.ok(!root.textContent.includes("技能库"));
    const t = {
      id: "t-test",
      business_type: "video",
      target_id: snapshot.project.episodes[0].shot_list.shots[0].id,
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

test("故事大纲按小段顺序展示正文、参考时长与因果衔接", () => {
  const dom = new JSDOM("<main></main>"),
    previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(),
      episode = snapshot.project.episodes[0],
      root = document.querySelector("main");
    episode.story_outline.segments = [
      { sequence: 2, duration_seconds: 6, body: "武松上路", causal: "因酒馆消息而动身" },
      { sequence: 1, duration_seconds: 4.5, body: "酒馆开场", causal: "承接开场来信" },
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
    assert.deepEqual(lines, [
      "1. 4.5秒 酒馆开场\n因果衔接：承接开场来信",
      "2. 6秒 武松上路\n因果衔接：因酒馆消息而动身",
    ]);
    episode.story_outline.node_state.status = "running";
    episode.summary.node_state.status = "empty";
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
      cards[0].querySelector(".node-ui-status").textContent,
      "生成中",
    );
    assert.equal(
      cards[1].querySelector(".node-ui-status").textContent,
      "未生成",
    );
    assert.equal(
      [...cards[1].querySelectorAll("button")].some((button) =>
        ["人工编辑", "人工放行"].includes(button.textContent),
      ),
      false,
    );
    assert.equal(cards[2].querySelector(".status-label"), null);
    assert.match(cards[2].textContent, /本集剧情原文/);
    assert.ok(
      [...cards[2].querySelectorAll("button")].some(
        (button) => button.textContent === "编辑剧情",
      ),
    );
    assert.equal(
      [...root.querySelectorAll("button")].some((button) => button.textContent === "编辑时长"),
      false,
    );
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

test("镜头表九字段按序直接展开，时长在标题旁且不重复展示下游模型", () => {
  const dom = new JSDOM("<main></main>"), previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0],
      root = document.querySelector("main"), shots = episode.shot_list.shots;
    for (const [index, shot] of shots.entries()) {
      Object.assign(shot, {
        title: `镜头标题${index + 1}`, duration_seconds: 5 + index,
        body: `镜头正文${index + 1}`, shot_scale: "近景", hook: "人物察觉异样",
        continuity_transition: "承接前镜抬头动作",
        reference_anchor: { fixed_landmark: "门槛", character_positions: "门内左侧", departed_characters: "王婆已离场", lighting: "窗外冷光" },
        audio_arrangement: { narration: "日色将晚", dialogue: "且慢", sound_effects: "落碗声" },
        actual_duration_seconds: 9.75,
      });
      shot.seconds_storyboard.storyboard[0].action = "不应展示的每秒分镜";
      shot.text_to_video_prompt.integrated_multimodal_description = "不应展示的视频提示词";
      shot.video.address = "hidden-video.mp4";
    }
    episode.shot_list.shots = [...shots].reverse();
    renderTaskPanel(root, snapshot, {
      session_id: "session-test", view: { page: "episode", episode_id: episode.id, tab: "shots" },
      refresh: async () => {}, paint: () => {}, onError: () => {},
    });
    const cards = [...root.querySelectorAll(".shot-card")];
    assert.deepEqual(cards.map(card => card.querySelector(".outline-head h3").textContent), [
      "S01 镜头标题1 · 5s", "S02 镜头标题2 · 6s",
    ]);
    assert.equal(root.querySelectorAll("details, [aria-expanded]").length, 0);
    assert.equal(root.querySelector('[data-business="shots"] .prompt'), null);
    for (const [index, card] of cards.entries()) {
      assert.equal(root.textContent.split(`镜头正文${index + 1}`).length - 1, 1);
      for (const text of ["景别：近景", "钩子：人物察觉异样", "连续性衔接：承接前镜抬头动作", "参考锚点", "固定地标：门槛", "人物位置：门内左侧", "离场角色：王婆已离场", "光位：窗外冷光", "音频安排", "旁白：日色将晚", "对白：且慢", "音效：落碗声"])
        assert.ok(card.textContent.includes(text), text);
    }
    assert.doesNotMatch(root.textContent, /不应展示|hidden-video|9\.75|shot_scale|reference_anchor|seconds_storyboard/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test("项目详情状态与操作按钮同一排，生成按钮按内容显示", () => {
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
    project.character_library.node_state.status = "empty";
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
    const titled = (title) =>
      [...root.querySelectorAll("section")].find(
        (card) => card.querySelector("h3")?.textContent === title,
      );
    assert.equal(outline.querySelector(".section-titles h3").textContent, "项目摘要");
    assert.equal(outline.querySelector(".node-ui-status").textContent, "已生成");
    assert.equal(outline.querySelector(".section-titles .status-label"), null);
    assert.deepEqual(
      labelsOf(outline).filter((label) => ["AI生成", "重新生成", "按意见修改"].includes(label)),
      ["重新生成"],
    );
    assert.deepEqual(
      labelsOf(cardOf("剧本")).filter((label) => ["AI生成", "重新生成", "按意见修改"].includes(label)),
      [],
    );
    assert.equal(cardOf("剧本").querySelector(".status-label"), null);
    assert.equal(titled("提取人物").querySelector(".node-ui-status").textContent, "未生成");
    assert.deepEqual(labelsOf(titled("提取人物")), ["AI生成", "人工编辑", "任务历史"]);
    assert.equal(titled("生成定妆照").querySelector(".node-ui-status").textContent, "未生成");
    assert.equal(titled("生成定妆照").querySelector("input"), null);
    assert.ok(cardOf("剧集").querySelector("[aria-label=重新拆分剧集]"));
    assert.ok(![...root.querySelectorAll("button")].some((button) => button.textContent.includes("添加角色")));
    project.creation_mode = "剧本";
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
    assert.equal(cardOf("剧集").querySelector(".section-titles .status-label"), null);
    assert.equal(cardOf("剧集").querySelector(".workflow-generation-row .node-ui-status").textContent, "生成中");
    assert.equal(cardOf("剧集").querySelector("[aria-label=重新拆分剧集]"), null);
    assert.deepEqual(labelsOf(cardOf("剧本")), []);
    project.creation_mode = "自由创作";
    project.project_summary.node_state.status = "rejected";
    project.character_library.node_state.status = "rejected";
    project.character_library.node_state.reason = "未通过";
    project.character_library.characters = [{ id: "c1", number: "C01", name: "武松", position: "好汉", costumes: [], costume_images: [{ costume_id: "", address: "" }] }];
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
      root.querySelector("[data-business=project-summary] .node-ui-status").textContent,
      "未通过",
    );
    assert.equal(
      [...root.querySelector("[data-business=project-summary]").querySelectorAll("button")].some((button) =>
        ["人工编辑", "人工放行"].includes(button.textContent),
      ),
      false,
    );
    assert.deepEqual(
      labelsOf(cardOf("项目摘要")).filter((label) => ["重新生成", "按意见修改"].includes(label)),
      ["重新生成", "按意见修改"],
    );
    assert.equal(cardOf("剧本").querySelector(".section-titles .status-label"), null);
    assert.equal(cardOf("剧本").querySelector(".workflow-generation-row .node-ui-status").textContent, "未通过");
    assert.deepEqual(
      labelsOf(cardOf("剧本")).filter((label) => ["重新生成", "按意见修改"].includes(label)),
      [],
    );
    assert.equal(titled("提取人物").querySelector(".node-ui-status").textContent, "未通过");
    assert.ok(titled("提取人物").textContent.includes("未通过"));
    assert.deepEqual(labelsOf(titled("提取人物")), ["重新生成", "按意见修改", "人工编辑", "人工放行", "任务历史"]);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});
