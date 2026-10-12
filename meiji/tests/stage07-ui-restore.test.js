import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { projectDialog, detailsDialog } from "../client/project-forms.js";
import { editor, fieldsForm } from "../client/content-forms.js";
import { renderTaskPanel } from "../client/task-panel.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { snapshotFixture } from "./fixtures/project.js";
import { blankCharacter } from "../client/resource-ui.js";
const tick = () => new Promise((r) => setTimeout(r, 0));
async function domTest(work) {
  const dom = new JSDOM("<main></main>", { url: "http://localhost" }),
    saved = {
      document: globalThis.document,
      window: globalThis.window,
      fetch: globalThis.fetch,
    };
  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
  });
  dom.window.HTMLDialogElement.prototype.show = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  try {
    await work(document.querySelector("main"), dom);
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
}
const submit = (form, dom) =>
  form.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
test("UI-1 原创建表单默认剧本；本地导入、移除和自由模式提交新契约", () =>
  domTest(async (root, dom) => {
    let output;
    const dialog = projectDialog(root, (v) => {
      output = v;
    });
    assert.equal(dialog.querySelector("#project-mode").value, "script");
    assert.equal(dialog.querySelector(".create-premise-fields").hidden, true);
    assert.equal(dialog.querySelectorAll("textarea").length, 1);
    const upload = dialog.querySelector("input[type=file]");
    Object.defineProperty(upload, "files", {
      value: [{ name: "恢复剧本.txt", size: 20, text: async () => "第一幕" }],
      configurable: true,
    });
    await upload.onchange();
    assert.equal(dialog.querySelector("#title").value, "恢复剧本");
    submit(dialog.querySelector("form"), dom);
    await tick();
    assert.equal(output.创作方式, "剧本");
    assert.equal(output.剧本.正文, "第一幕");
    assert.equal(output.画幅, "1344x768");
    const second = projectDialog(root, (v) => {
      output = v;
    });
    const mode = second.querySelector("#project-mode");
    mode.value = "free";
    mode.onchange();
    assert.equal(second.querySelector(".create-script-fields").hidden, true);
    second.querySelector("#title").value = "自由故事";
    second.querySelector("#project-premise").value = "新的方向";
    submit(second.querySelector("form"), dom);
    await tick();
    assert.equal(output.创作方式, "自由创作");
    assert.equal(output.创作方向, "新的方向");
    assert.equal("剧本" in output, false);
  }));
test("UI-1 素材库选择剧本按正文提交，未选择不得创建", () =>
  domTest(async (root, dom) => {
    let calls = 0,
      value;
    globalThis.fetch = async (url) =>
      url.endsWith("/library")
        ? {
            ok: true,
            json: async () => ({
              assets: [
                { id: "asset", category: "scripts", originalName: "素材.txt" },
              ],
            }),
          }
        : { ok: true, text: async () => "库中剧本" };
    const d = projectDialog(root, (v) => {
      calls++;
      value = v;
    });
    d.querySelector("#title").value = "素材";
    submit(d.querySelector("form"), dom);
    await tick();
    assert.equal(calls, 0);
    assert.match(d.querySelector(".error").textContent, /导入或选择/);
    await d.querySelector(".script-choose").onclick();
    d.querySelector("select.script-picker").value = "asset";
    await d.querySelector("select.script-picker").onchange();
    assert.equal(d.querySelector(".script-selected").textContent, "素材.txt");
    d.querySelector(".script-clear").click();
    assert.equal(d.querySelector(".script-clear").hidden, true);
    d.querySelector("select.script-picker").value = "asset";
    await d.querySelector("select.script-picker").onchange();
    submit(d.querySelector("form"), dom);
    await tick();
    assert.equal(value.剧本.正文, "库中剧本");
  }));
test("UI-2/3 概要原卡片、剧本入口；剧集四标签和镜头两标签保持返回层级", () =>
  domTest((root) => {
    const snap = snapshotFixture(),
      view = { page: "overview", tab: "script" },
      context = {
        session_id: "s",
        view,
        refresh: async () => {},
        onError: () => {},
        paint: () => renderTaskPanel(root, snap, context),
      };
    context.paint();
    assert.ok(root.querySelector(".summary-preview"));
    assert.ok(root.querySelector(".episode-card .episode-cover"));
    assert.ok(root.querySelector(".script-title-row"));
    assert.equal(root.querySelector("nav.tabs"), null);
    assert.equal(root.querySelector("pre"), null);
    root.querySelector(".episode-card").click();
    assert.equal(view.page, "episode");
    assert.equal(root.querySelectorAll(".stage-overview .stage").length, 4);
    snap.project.剧集[0].镜头表.镜头[0].标题 = "开门";
    view.tab = "shots";
    context.paint();
    const firstShot = root.querySelector(".shot-card");
    assert.equal(firstShot.querySelector("h3").textContent, "S01 开门 · 5s");
    assert.equal(firstShot.querySelector("details"), null);
    assert.equal(firstShot.querySelector(".prompt").textContent, "剧情");
    view.tab = "film";
    context.paint();
    assert.equal(root.querySelectorAll(".shot-card").length, 2);
    assert.equal(root.querySelector("[data-business=video]"), null);
    [...root.querySelectorAll("button")]
      .find((b) => b.textContent === "打开镜头")
      .click();
    assert.equal(root.querySelectorAll(".stage-overview .stage").length, 0);
    assert.ok(root.querySelector("[data-business=video]"));
    root.querySelector("[aria-label=返回镜头]").click();
    assert.equal(view.shot_id, null);
    root.querySelector("[aria-label=返回项目概要]").click();
    assert.equal(view.page, "overview");
    root.querySelector("[aria-label=打开剧本详情]").click();
    assert.equal(view.page, "script");
    assert.match(root.textContent, /完整剧本/);
  }));
test("UI-3 编辑小段/对白/提示词使用字段和时段，提交类型与未知人物称谓保持正确", () =>
  domTest(async (root, dom) => {
    let result;
    const value = {
      衔接上一镜方式: "尾帧衔接",
      内容: {
        事件: "事件",
        节拍: [
          {
            开始秒: 0,
            结束秒: 5,
            动作: "动作",
            镜头: "镜头",
            空间: "空间",
            声音: "声音",
            交接: "结束",
            对白: [
              { 说话人编号: "路人", 方式: "画外", 原话: "快走", 表演: "急切" },
            ],
          },
        ],
        环境声: [],
        配乐: [],
      },
    };
    const d = editor(root, "每秒分镜", value, (v) => {
      result = v;
    });
    assert.equal(d.querySelector("textarea").value, "事件");
    d.querySelector("[name=原话]").value = "回来";
    submit(d.querySelector("form"), dom);
    await tick();
    assert.equal(result.内容.节拍[0].对白[0].说话人编号, "路人");
    assert.equal(result.内容.节拍[0].对白[0].原话, "回来");
    assert.equal(result.内容.节拍[0].结束秒, 5);
    const f = fieldsForm({ 正文: [] });
    root.append(f.box);
    [...f.box.querySelectorAll("button")]
      .find((b) => b.textContent === "＋ 添加正文")
      .click();
    assert.equal(typeof f.read().正文[0].对白, "string");
  }));
test("UI-4 人物文字网格/服装详情和编号，运行冻结；不显示内部 ID", () =>
  domTest((root) => {
    const snap = snapshotFixture(),
      c = {
        ...blankCharacter(),
        名称: "小明",
        服装: [{ 编号: "C01-01", 名称: "日常服", 描述: "灰色外套" }],
        默认服装编号: "C01-01",
      };
    snap.project.角色库.角色 = mergeCharacters(snap.project, [c]).characters;
    const role = snap.project.角色库.角色[0],
      view = { page: "character", character_id: role.id },
      context = {
        view,
        session_id: "s",
        refresh: async () => {},
        onError: () => {},
        paint: () => renderTaskPanel(root, snap, context),
      };
    context.paint();
    assert.ok(root.querySelector(".image-text-editor .image-text-grid"));
    assert.ok(root.querySelector(".character-wardrobe .wardrobe-name"));
    assert.equal(root.textContent.includes(role.id), false);
    root.querySelector(".wardrobe-name").click();
    assert.ok(root.querySelector(".costume-detail"));
    assert.ok(root.querySelector("[name=描述]"));
    snap.tasks = [{ task_status: "running" }];
    context.paint();
    assert.ok(
      [
        ...root.querySelectorAll(
          ".image-text-editor input,.image-text-editor textarea",
        ),
      ].every((n) => n.disabled),
    );
  }));
test("UI-5 设置为语言表单/规则入口；历史筛选和步骤独立详情", () =>
  domTest((root) => {
    const snap = snapshotFixture(),
      view = { page: "settings" },
      context = {
        view,
        session_id: "s",
        refresh: async () => {},
        onError: () => {},
        paint: () => renderTaskPanel(root, snap, context),
      };
    context.paint();
    assert.ok(root.querySelector(".settings-page select[name=输出语言]"));
    assert.equal(root.querySelector("pre"), null);
    snap.tasks = [
      {
        id: "t",
        group_id: "g",
        group_seq: 1,
        target_id: snap.project.id,
        business_type: "project-summary",
        task_status: "completed",
        queue_order: 1,
      },
    ];
    snap.groups = [{ id: "g", group_type: "single" }];
    snap.steps = [
      {
        id: "step",
        task_id: "t",
        seq: 1,
        kind: "generate",
        step_status: "done",
        result: "结果",
      },
    ];
    view.page = "history";
    context.paint();
    assert.equal(root.querySelectorAll(".run-filters select").length, 3);
    assert.equal(root.querySelector("pre"), null);
    root.querySelector(".run-list-heading button").click();
    assert.ok(root.querySelector(".run-detail-page .run-step-card"));
    assert.match(root.querySelector("pre").textContent, /结果/);
  }));
test("UI-1/3 项目、剧集编辑保留原标签并提交数值时长", () =>
  domTest(async (root, dom) => {
    let result;
    const d = detailsDialog(
      root,
      "新增剧集",
      { 时长秒: 150, 本集要求: "" },
      (v) => {
        result = v;
      },
      { episode: true },
    );
    assert.ok(d.querySelector("form.episode"));
    assert.match(d.textContent, /本集时长（秒）/);
    d.querySelector("[name=时长秒]").value = "60";
    submit(d.querySelector("form"), dom);
    await tick();
    assert.equal(result.时长秒, 60);
  }));
test("UI-5 片库恢复短剧状态/素材分类/原卡片，分类切换不显示其他素材", () =>
  domTest(async (root) => {
    const { renderLibrary } = await import("../client/library-ui.js"),
      state = {},
      env = {
        state,
        valid: () => true,
        paint: () => {},
        report: () => {},
        open: () => {},
        remove: () => {},
        create: () => {},
      };
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith("/projects")
          ? {
              projects: [
                {
                  id: "p",
                  名称: "未完成",
                  画幅: "1344x768",
                  集数: 1,
                  已完成: false,
                },
                {
                  id: "q",
                  名称: "已完成",
                  画幅: "768x1344",
                  集数: 2,
                  已完成: true,
                },
              ],
            }
          : {
              assets: [
                {
                  id: "img",
                  originalName: "人物.png",
                  mime: "image/png",
                  category: "characters",
                },
                {
                  id: "txt",
                  originalName: "剧本.txt",
                  mime: "text/plain",
                  category: "scripts",
                },
              ],
            },
    });
    await renderLibrary(root, env);
    assert.ok(root.querySelector(".library-view"));
    assert.match(root.textContent, /未完成/);
    assert.equal(root.textContent.includes("768x1344"), false);
    state.library_status = "completed";
    await renderLibrary(root, env);
    assert.match(root.textContent, /768x1344/);
    state.library_tab = "assets";
    state.library_category = "scripts";
    await renderLibrary(root, env);
    assert.equal(
      root.querySelectorAll("[aria-label=素材分类] button").length,
      5,
    );
    assert.equal(root.querySelectorAll(".asset-card").length, 1);
    assert.match(root.querySelector(".asset-card").textContent, /剧本.txt/);
    assert.ok(root.querySelector(".asset-toolbar input[type=file]"));
  }));
test("UI-6 设置语言和模型表单在事件刷新后保留草稿，运行中冻结", () =>
  domTest(async (root, dom) => {
    const { mount } = await import("../client/workbench.js"),
      { randomUUID } = await import("node:crypto"),
      saved = {
        localStorage: globalThis.localStorage,
        EventSource: globalThis.EventSource,
      },
      snap = snapshotFixture();
    let app;
    try {
      Object.assign(globalThis, {
        localStorage: dom.window.localStorage,
        EventSource: class {
          close() {}
        },
      });
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: "session-" + randomUUID() }),
      );
      globalThis.fetch = async (url) => ({
        ok: true,
        json: async () =>
          url.endsWith("/models")
            ? {
                settings: {
                  baseUrl: "http://localhost/v1",
                  chat: { model: "chat" },
                  story: { model: "story" },
                  image: { model: "image" },
                  video: { model: "video" },
                },
              }
            : { project_id: snap.project.id, snapshot: structuredClone(snap) },
      });
      app = mount();
      await app.refresh();
      app.shell.root.querySelector(".settings").click();
      await tick();
      const language = app.shell.content.querySelector("[name=输出语言]"),
        model = app.shell.content.querySelector("[name=剧情模型]");
      language.value = "en";
      language.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      model.value = "新的剧情模型";
      model.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      snap.runtime.revision++;
      await app.refresh();
      await tick();
      assert.equal(
        app.shell.content.querySelector("[name=输出语言]"),
        language,
      );
      assert.equal(language.value, "en");
      assert.equal(app.shell.content.querySelector("[name=剧情模型]"), model);
      assert.equal(model.value, "新的剧情模型");
      snap.tasks = [{ task_status: "running" }];
      snap.runtime.revision++;
      await app.refresh();
      await tick();
      assert.equal(language.disabled, true);
      assert.equal(model.disabled, true);
    } finally {
      app?.dispose();
      Object.assign(globalThis, saved);
    }
  }));
