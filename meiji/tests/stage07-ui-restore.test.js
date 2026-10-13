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
    assert.equal(output.creation_mode, "剧本");
    assert.equal(output.script.body, "第一幕");
    assert.equal(output.aspect_ratio, "1344x768");
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
    assert.equal(output.creation_mode, "自由创作");
    assert.equal(output.creative_direction, "新的方向");
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
    assert.equal(value.script.body, "库中剧本");
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
    snap.project.episodes[0].shot_list.shots[0].title = "开门";
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
    const value = { storyboard: [{ time_range: "0–5s", action: "动作", camera: "固定", space: "桌面", audio: "声音", handoff: "结束", dialogue: [{ speaker_name: "路人", speaker_id: "", mode: "画外", dialogue_text: "快走" }] }] };
    const d = editor(root, "每秒分镜", value, (v) => { result = v; });
    d.querySelector("[name=dialogue_text]").value = "回来";
    submit(d.querySelector("form"), dom); await tick();
    assert.equal(result.storyboard[0].dialogue[0].speaker_name, "路人");
    assert.equal(result.storyboard[0].dialogue[0].dialogue_text, "回来");
    assert.equal(result.storyboard[0].time_range, "0–5s");
    const f = fieldsForm({ storyboard: [] }); root.append(f.box);
    [...f.box.querySelectorAll("button")].find((b) => b.textContent === "＋ 添加每秒分镜").click();
    assert.equal(typeof f.read().storyboard[0].action, "string");
  }));
test("UI-4 人物文字网格/服装详情和编号，运行冻结；不显示内部 ID", () =>
  domTest((root) => {
    const snap = snapshotFixture(),
      c = {
        ...blankCharacter(),
        name: "小明",
        costumes: [{ name: "日常服", color: "灰色", material: "", props: "" }],
      };
    snap.project.character_library.characters = mergeCharacters(snap.project, [c]).characters;
    const role = snap.project.character_library.characters[0],
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
    assert.ok(root.querySelector("[name=color]"));
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
    assert.ok(root.querySelector(".settings-page select[name=output_language]"));
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
      { duration_seconds: 150, episode_requirements: "" },
      (v) => {
        result = v;
      },
      { episode: true },
    );
    assert.ok(d.querySelector("form.episode"));
    assert.match(d.textContent, /本集时长（秒）/);
    d.querySelector("[name=duration_seconds]").value = "60";
    submit(d.querySelector("form"), dom);
    await tick();
    assert.equal(result.duration_seconds, 60);
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
                  name: "未完成",
                  aspect_ratio: "1344x768",
                  episode_count: 1,
                  completed: false,
                },
                {
                  id: "q",
                  name: "已完成",
                  aspect_ratio: "768x1344",
                  episode_count: 2,
                  completed: true,
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
      const language = app.shell.content.querySelector("[name=output_language]"),
        model = app.shell.content.querySelector("[name=剧情模型]");
      language.value = "en";
      language.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      model.value = "新的剧情模型";
      model.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      snap.runtime.revision++;
      await app.refresh();
      await tick();
      assert.equal(
        app.shell.content.querySelector("[name=output_language]"),
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

test("无服装角色可直接打开定妆照卡；新增服装后旧空图只读且可查看历史", () =>
  domTest(async (root) => {
    const { emptyCharacterModel } = await import("../shared/models/character_model.js");
    const { emptyCostumeModel } = await import("../shared/models/costume_model.js");
    const { emptyCostumeImageModel } = await import("../shared/models/costume_image_model.js");
    const snap = snapshotFixture();
    const c = emptyCharacterModel({ name: "甲", number: "C01", body_type: "健壮", costume_images: [emptyCostumeImageModel()] });
    snap.project.character_library.characters = [c];
    const view = { page: "character", character_id: c.id, costume_id: "" };
    const context = { view, session_id: "s", refresh: async () => {}, onError: () => {}, paint: () => renderTaskPanel(root, snap, context) };
    context.paint();
    let card = root.querySelector('[data-business="costume-image"]');
    assert.ok([...card.querySelectorAll("button")].some((button) => button.textContent === "AI生成"));
    c.costume_images[0].address = "old.png";
    c.costumes = [emptyCostumeModel({ name: "常服", number: "C01-01" })];
    c.costume_images.push(emptyCostumeImageModel(c.costumes[0].id));
    context.paint();
    card = root.querySelector('[data-business="costume-image"]');
    assert.ok(card.querySelector('img[src^="old.png"]'));
    assert.deepEqual([...card.querySelectorAll('.workflow-generation-row button')].map((button) => button.textContent), ["任务历史"]);
    card.querySelector('.workflow-generation-row button').click();
    assert.equal(view.target_id, c.id);
    assert.equal(view.history_business, "costume-image");
    assert.equal(c.costume_images.length, 2);
  }));
