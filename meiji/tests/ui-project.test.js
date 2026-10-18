import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel, episodeTabs } from "../client/task-panel.js";
import { PanelContext } from "../client/task-client.js";
import { snapshotFixture, taskFixture, projectFixture } from "./fixtures/project.js";
import { randomUUID } from "node:crypto";
import { mount } from "../client/workbench.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppRuntime } from "../server/runtime/app-runtime.js";

describe("panel", () => {
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

  test("会话、项目与版本守卫拒绝晚到/乱序响应", () => {
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
  test("实际 DOM 保留页面与四标签，状态/原因直读，运行中冻结编辑且允许取消", () => {
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
      assert.ok(root.textContent.includes("场景：本镜描述"));
      assert.ok(!root.textContent.includes("道具"));
      assert.ok(!root.textContent.includes("生成要求"));
      const episode = snapshot.project.episodes[0];
      episode.shot_list.node_state.status = "rejected";
      episode.shot_list.node_state.reason = "保留审核原因";
      const failureReason = "镜头表：镜头总时长超出允许范围（本集参考时长±30秒，允许 1–40 秒）";
      snapshot.tasks.push({business_type:"shots",target_id:episode.id,task_status:"failed",end_reason:failureReason,queue_order:99});
      episode.shot_list.shots[0].body = "最终超时生成镜头内容";
      view.tab = "shots";
      renderTaskPanel(root, snapshot, context);
      assert.ok(root.querySelector('[data-business="shots"]'));
      assert.ok(!root.querySelector('[data-business="episode-characters"]'));
      assert.ok(root.textContent.includes("失败"));
      assert.ok(root.textContent.includes(failureReason));
      assert.ok(root.textContent.includes("最终超时生成镜头内容"));
      const shotCard = root.querySelector('[data-business="shots"]'),
        title = shotCard.querySelector(".section-head"),
        ui = shotCard.querySelector(".node-ui"),
        actions = ui.querySelector(".workflow-generation-row");
      assert.equal(title.nextElementSibling, ui);
      assert.equal(title.querySelector(".node-data-tag").textContent, "未通过");
      assert.equal(ui.querySelector(".node-ui-status"), null);
      assert.deepEqual([...actions.children].map((node) => node.className), ["node-ui-buttons", "node-ui-task-status"]);
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
      view.tab = "film";
      view.shot_id = t.target_id;
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

  test("分集改编按小段顺序展示正文、参考时长与因果衔接", () => {
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
      snapshot.tasks.push({business_type:"outline",target_id:episode.id,task_status:"running",queue_order:99});
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
        ["分集改编", "本集摘要", "本集规划"],
      );
      assert.equal(cards[0].querySelector(".node-data-tag").textContent, "已生成");
      assert.equal(cards[1].querySelector(".node-data-tag").textContent, "未生成");
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
          (button) => button.textContent === "编辑规划",
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
          on_screen_characters: [], background_characters: "", audio_arrangement: { narration: "日色将晚", dialogue: "且慢", sound_effects: "落碗声" },
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
        assert.equal(card.querySelectorAll(".prompt").length, 1);
        assert.ok(card.querySelector(".prompt.full").textContent.startsWith(`正文：镜头正文${index + 1}`));
        assert.equal(card.querySelector("button"), null);
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
      assert.equal(outline.querySelector(".node-data-tag").textContent, "已生成");
      assert.equal(outline.querySelector(".section-titles .status-label"), null);
      assert.deepEqual(
        labelsOf(outline).filter((label) => ["AI生成", "重新生成", "原结果修订"].includes(label)),
        ["重新生成", "原结果修订"],
      );
      assert.deepEqual(
        labelsOf(cardOf("剧本")).filter((label) => ["AI生成", "重新生成", "原结果修订"].includes(label)),
        [],
      );
      assert.equal(cardOf("剧本").querySelector(".status-label"), null);
      assert.equal(titled("提取人物").querySelector(".node-data-tag").textContent, "未生成");
      assert.deepEqual(labelsOf(titled("提取人物")), ["AI生成", "人工编辑", "任务历史", "查看规则"]);
      assert.equal(titled("生成定妆照").querySelector(".node-ui-status").textContent, "未生成");
      assert.equal(titled("生成定妆照").querySelector("input"), null);
      assert.ok(cardOf("剧集").querySelector("[aria-label=重新生成]"));
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
      assert.equal(cardOf("剧集").querySelector(".node-data-tag").textContent, "已生成");
      assert.equal(cardOf("剧集").querySelector(".workflow-generation-row .node-ui-status"), null);
      assert.deepEqual([...cardOf("剧集").querySelector(".workflow-generation-row").children].map((node) => node.className), ["node-ui-buttons", "node-ui-task-status"]);
      assert.equal(cardOf("剧集").querySelector("[aria-label=重新生成]"), null);
      assert.ok([...cardOf("剧集").querySelectorAll("button")].some((button) => button.textContent === "取消"));
      assert.ok([...cardOf("剧集").querySelectorAll("button")].some((button) => button.textContent === "任务历史"));
      // 原始剧本只读展示，不再挂载审核按钮。
      assert.deepEqual(labelsOf(cardOf("剧本")), []);
      project.creation_mode = "自由创作";
      project.project_summary.node_state.status = "rejected";
      project.project_summary.node_state.reason = "摘要缺少结局";
      project.character_library.node_state.status = "rejected";
      project.character_library.node_state.reason = "未通过";
      project.character_library.characters = [{ id: "c1", name: "武松", position: "好汉", costumes: [], costume_images: [{ costume_id: "", address: "" }] }];
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
        root.querySelector("[data-business=project-summary] .node-data-tag").textContent,
        "未通过",
      );
      assert.equal(
        [...root.querySelector("[data-business=project-summary]").querySelectorAll("button")].some((button) =>
          ["人工编辑", "人工放行"].includes(button.textContent),
        ),
        false,
      );
      assert.deepEqual(
        labelsOf(cardOf("项目摘要")).filter((label) => ["重新生成", "原结果修订", "修复"].includes(label)),
        ["重新生成"],
      );
      assert.equal(cardOf("项目摘要").querySelector('.node-ui-repair-row button').textContent, '修复（再给 2 轮）');
      assert.equal(cardOf("剧本").querySelector(".section-titles .status-label"), null);
      assert.equal(cardOf("剧本").querySelector(".workflow-generation-row .node-ui-status"), null);
      assert.deepEqual(
        labelsOf(cardOf("剧本")).filter((label) => ["重新生成", "原结果修订"].includes(label)),
        [],
      );
      assert.equal(titled("提取人物").querySelector(".node-data-tag").textContent, "未通过");
      assert.ok(titled("提取人物").textContent.includes("未通过"));
      assert.deepEqual(labelsOf(titled("提取人物")), ["重新生成", "人工编辑", "任务历史", "查看规则"]);
      assert.deepEqual([...titled("提取人物").querySelectorAll('.node-ui-repair-row button')].map((b) => b.textContent), ['修复（再给 2 轮）', '人工放行']);
    } finally {
      globalThis.document = previous;
      dom.window.close();
    }
  });

  test("新建项目没有剧集时概览可以渲染，占位按钮打开对应操作", () => {
    const dom = new JSDOM("<main></main>", { url: "http://localhost" }), previous = globalThis.document;
    globalThis.document = dom.window.document;
    dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
    try {
      const snapshot = snapshotFixture(), root = document.querySelector("main"), view = { page: "overview" };
      snapshot.project.episodes = [];
      const paint = (mode) => {
        snapshot.project.creation_mode = mode;
        root.replaceChildren();
        renderTaskPanel(root, snapshot, { session_id: "session-test", view, refresh: async () => {}, paint: () => {}, onError: () => {} });
      };
      paint("自由创作");
      const freePlaceholder = root.querySelector(".episode-placeholder");
      assert.equal(freePlaceholder.querySelector("p").textContent, "新增剧集后开始制作");
      freePlaceholder.querySelector("button").click();
      assert.match(root.querySelector("dialog").textContent, /新增剧集/);
      paint("剧本");
      const scriptPlaceholder = root.querySelector(".episode-placeholder");
      assert.equal(scriptPlaceholder.querySelector("p").textContent, "完成全集规划后开始制作");
      scriptPlaceholder.querySelector("button").click();
      assert.match(root.querySelector("dialog").textContent, /参考单集时长/);
    } finally {
      globalThis.document = previous;
      dom.window.close();
    }
  });

  test('编辑规划可调整本集时长，保存走项目命令并完整保留原剧情', async () => {
    const dom = new JSDOM('<main></main>'), savedDocument = globalThis.document, savedFetch = globalThis.fetch;
    globalThis.document = dom.window.document;
    const calls = [];
    globalThis.fetch = async (path, options) => {
      calls.push({ path, ...JSON.parse(options.body) });
      return { ok: true, json: async () => ({}) };
    };
    try {
      const snapshot = snapshotFixture(), e = snapshot.project.episodes[0], root = document.querySelector('main');
      const original = e.plot;
      renderTaskPanel(root, snapshot, { session_id: 'session-test', view: { page: 'episode', episode_id: e.id, tab: 'script' }, refresh: async () => {}, paint: () => {}, onError: () => {} });
      [...root.querySelectorAll('button')].find(b => b.textContent === '编辑规划').click();
      const dialog = root.querySelector('dialog');
      dialog.close = () => dialog.remove();
      assert.equal(dialog.querySelector('[name="plot"]').value, original);
      assert.equal(Number(dialog.querySelector('[name="duration_seconds"]').value), e.duration_seconds);
      dialog.querySelector('[name="duration_seconds"]').value = '240';
      await dialog.querySelector('form').onsubmit({ preventDefault() {} });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].path, '/api/meiji/project-command');
      assert.equal(calls[0].command.type, 'edit-episode');
      assert.equal(calls[0].command.episode_id, e.id);
      assert.deepEqual(calls[0].command.fields, { plot: original, duration_seconds: 240 });
      assert.equal(e.plot, original);
    } finally { globalThis.document = savedDocument; globalThis.fetch = savedFetch; dom.window.close(); }
  });
});

describe("project-delete", () => {
  async function until(check) {
   for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}
   assert.fail('等待面板更新超时');
  }
  async function fixture(work) {
   const dom=new JSDOM('<body></body>',{url:'http://localhost',pretendToBeVisual:true}), saved={};
   for(const key of ['window','document','localStorage','EventSource','fetch'])saved[key]=globalThis[key];
   const sid=`session-${randomUUID()}`, s=snapshotFixture(), other=snapshotFixture(), streams=[];
   s.project.name='待删除甲';other.project.name='保留乙';
   const api={projects:[s,other],bound:s,fail:false,confirmed:true,deletes:0};let app;
   try {
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,EventSource:class{constructor(){streams.push(this);}close(){this.closed=true;}}});
    window.confirm=()=>api.confirmed;
    localStorage.setItem('dsh.sessions.current',JSON.stringify({sessionId:sid}));
    globalThis.fetch=async(url,options)=>{
     if(url.endsWith('/project-command')){
      const {command}=JSON.parse(options.body);api.deletes++;
      if(api.waitDelete)await api.waitDelete;
      if(api.fail)return {ok:false,json:async()=>({message:'项目仍有未结束任务'})};
      api.projects=api.projects.filter(p=>p.project.id!==command.project_id);
      if(api.bound?.project.id===command.project_id)api.bound=null;
      return {ok:true,json:async()=>({deleted:true})};
     }
     if(url.endsWith('/projects'))return {ok:true,json:async()=>({projects:api.projects.map(p=>({id:p.project.id,name:p.project.name,aspect_ratio:p.project.aspect_ratio,集数:1}))})};
     if(url.includes('/context?')){
      const snapshot=api.bound?structuredClone(api.bound):null;
      if(api.waitContext){const wait=api.waitContext;api.waitContext=null;await wait;}
      return {ok:true,json:async()=>({project_id:snapshot?.project.id||null,snapshot})};
     }
     throw Error('意外请求'+url);
    };
    app=mount();await app.refresh();
    const click=(label,scope=app.shell.root)=>{const b=[...scope.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);b.click();};
    const library=async()=>{click('片库');await until(()=>app.shell.content.textContent.includes('保留乙'));};
    await work({app,api,s,other,streams,click,library});
   } finally {app?.dispose();for(const [key,v]of Object.entries(saved)){if(v===undefined)delete globalThis[key];else globalThis[key]=v;}dom.window.close();}
  }

  test('片库删除当前项目立即更新列表、清上下文/订阅，晚到刷新不恢复',()=>fixture(async({app,api,s,streams,click,library})=>{
   await library();let release;api.waitContext=new Promise(r=>release=r);const late=app.refresh();
   const card=[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('待删除甲'));
   click('删除项目',card);await until(()=>api.deletes===1&&!app.shell.content.textContent.includes('待删除甲'));
   assert.equal(app.context.read(),null);assert.equal(app.context.token().project_id,null);assert.ok(streams.every(s=>s.closed));
   assert.equal(app.shell.root.querySelector('.brand').textContent,'极乐世界');
   release();await late;assert.equal(app.context.read(),null);
   click('极乐世界');await until(()=>app.shell.content.textContent.includes('保留乙'));assert.doesNotMatch(app.shell.content.textContent,/待删除甲/);
  }));

  test('概要删除后空context自动回片库并关闭旧订阅',()=>fixture(async({app,streams,click})=>{
   click('删除项目');await until(()=>app.context.read()===null&&app.shell.content.textContent.includes('保留乙'));
   assert.equal(app.view.page,'library');assert.equal(app.shell.root.querySelector('.brand').textContent,'极乐世界');assert.ok(streams.every(s=>s.closed));
  }));

  for (const page of ['overview', 'library'])
   test(`运行中的项目可从 ${page} 删除`,()=>fixture(async({app,api,s,click,library})=>{
    s.tasks.push(taskFixture(s.project, 'project-summary', s.project.id, { task_status: 'running' }));
    s.runtime.revision++;
    await app.refresh();
    if (page === 'library') await library();
    const scope=page === 'library' ? [...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('待删除甲')) : app.shell.content;
    click('删除项目',scope);
    await until(()=>api.deletes===1 && app.context.read()===null);
   }));

  test('取消与失败均保留当前项目和订阅',()=>fixture(async({app,api,s,streams,click,library})=>{
   await library();const card=()=>[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('待删除甲'));
   api.confirmed=false;click('删除项目',card());assert.equal(api.deletes,0);assert.equal(app.context.read().project.id,s.project.id);
   api.confirmed=true;api.fail=true;click('删除项目',card());await until(()=>api.deletes===1);await new Promise(r=>setTimeout(r,0));
   assert.equal(app.context.read().project.id,s.project.id);assert.equal(streams.at(-1).closed,undefined);assert.match(app.shell.content.textContent,/待删除甲/);
  }));

  test('删除其他项目仅更新列表，不清当前项目',()=>fixture(async({app,api,s,streams,click,library})=>{
   await library();const card=[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('保留乙'));
   click('删除项目',card);await until(()=>api.deletes===1&&!app.shell.content.textContent.includes('保留乙'));
   assert.equal(app.context.read().project.id,s.project.id);assert.equal(streams.at(-1).closed,undefined);assert.equal(app.view.page,'library');
  }));

  test('删除等待期间切换上下文，旧回调不清新项目',()=>fixture(async({app,api,other,click,library})=>{
   await library();let release;api.waitDelete=new Promise(r=>release=r);
   const card=[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('待删除甲'));click('删除项目',card);await until(()=>api.deletes===1);
   app.context.select(app.context.token().session_id,other.project.id);app.context.accept(app.context.token(),other);api.bound=other;
   release();await new Promise(r=>setTimeout(r,10));assert.equal(app.context.read().project.id,other.project.id);
  }));
});

describe("project-delete-runtime", () => {
  for (const state of ['idle', 'queued', 'running']) {
    test(`项目删除不受 ${state} 进度限制，取消执行并清除绑定`, async () => {
      const home = await mkdtemp(join(tmpdir(), 'meiji-delete-runtime-'));
      let release, started, aborted, signal;
      const wait = new Promise(r => { release = r; });
      const entered = new Promise(r => { started = r; });
      const cancelled = new Promise(r => { aborted = r; });
      const runtime = await createAppRuntime({ home, gateway: {
        chat: async options => {
          signal = options.signal;
          signal.addEventListener('abort', aborted, { once: true });
          started();
          await wait;
          return '晚到结果不能恢复项目';
        },
      } });
      const project = projectFixture(), other = projectFixture(), session = `session-${randomUUID()}`;
      const model = await runtime.repository.create(project);
      await runtime.repository.create(other);
      await runtime.bindings.bind(session, project.id);
      const submit = request_id => runtime.tasks.command({ type: 'submit', project_id: project.id,
        request_id, business_type: 'project-summary', target_id: project.id, action: 'regenerate' });
      try {
        if (state === 'queued') await seedQueuedTasks(model, [['project-summary',project.id]]);
        if (state === 'running') await submit('before-delete');
        if (state === 'running') await entered;
        const deletion = runtime.projectCommand({ type: 'delete', project_id: project.id }, session);
        if (state === 'running') {
          await cancelled;
          assert.equal(signal.aborted, true);
          await assert.rejects(submit('during-delete'), /正在删除/);
          assert.equal(model.readAll().tasks[0].task_status, 'cancelled');
          release();
        }
        assert.deepEqual(await deletion, { deleted: true });
        assert.equal(await runtime.bindings.projectForSession(session), null);
        await assert.rejects(runtime.repository.open(project.id), /不存在/);
        await assert.rejects(model.update('late-write', {}, () => ({})), /不存在/);
        assert.deepEqual((await runtime.repository.list()).map(p => p.id), [other.id]);
      } finally {
        release();
        await runtime.dispose();
        await rm(home, { recursive: true, force: true });
      }
    });
  }
});
