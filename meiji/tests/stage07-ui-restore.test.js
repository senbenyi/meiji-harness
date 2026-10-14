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
  const dom = new JSDOM("<main></main>", { url: "http://localhost", pretendToBeVisual: true }),
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
test("角色卡按任务组显示停止状态，继续最新续作组，完成和执行中不显示继续", () =>
  domTest(async (root) => {
    const snap = snapshotFixture(), commands = [];
    snap.project.character_library.node_state.status = "generated";
    snap.groups = [{ id: "roles", group_type: "workflow" }];
    snap.tasks = [
      { id: "extract", group_id: "roles", group_seq: 1, queue_order: 1, business_type: "project-characters", task_status: "completed" },
      { id: "image", group_id: "roles", group_seq: 2, queue_order: 2, business_type: "project-characters", task_status: "failed", end_reason: "图片失败" },
    ];
    globalThis.fetch = async (_url, options) => {
      commands.push(JSON.parse(options.body).command);
      return { ok: true, json: async () => ({}) };
    };
    const context = { session_id: "s", view: { page: "overview" }, refresh: async () => {}, onError: assert.fail };
    const paint = () => renderTaskPanel(root, snap, context);
    const next = () => [...root.querySelectorAll("button")].find(b => b.textContent === "继续");
    for (const status of ["failed", "rejected", "cancelled", "superseded"]) {
      snap.tasks[1].task_status = status;
      paint(); assert.ok(next(), status);
    }
    next().click(); await tick();
    assert.equal(commands[0].type, "continue-group"); assert.equal(commands[0].group_id, "roles");
    snap.groups.push({ id: "next", group_type: "workflow", action: "continue" });
    snap.tasks.push({ ...snap.tasks[1], id: "retry", group_id: "next", group_seq: 1, queue_order: 3, task_status: "rejected", end_reason: "续作未通过" });
    paint(); assert.match(root.textContent, /续作未通过/); next().click(); await tick();
    assert.equal(commands[1].group_id, "next");
    for (const status of ["completed", "queued", "running"]) {
      snap.tasks[2].task_status = status;
      paint(); assert.equal(next(), undefined, status);
    }
  }));
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
test("角色数组字段支持逐项编辑、添加和删除并保留数组类型", () =>
  domTest(root => {
    const form = fieldsForm({ signature_props: ["哨棒"], immutable_traits: [], props: [] });
    root.append(form.box);
    for (const label of ["签名道具", "不可改特征", "道具"])
      [...form.box.querySelectorAll("button")].find(b => b.textContent === "＋ 添加" + label).click();
    assert.deepEqual(form.read(), { signature_props: ["哨棒", ""], immutable_traits: [""], props: [""] });
    [...form.box.querySelectorAll("button")].find(b => b.textContent === "移除").click();
    assert.deepEqual(form.read().signature_props, [""]);
  }));

test("UI-4 人物文字网格/服装详情和编号，运行冻结；不显示内部 ID", () =>
  domTest((root) => {
    const snap = snapshotFixture(),
      c = {
        ...blankCharacter(),
        name: "小明",
        gender: "男",
        era: "现代",
        costumes: [{ name: "日常服", color: "灰色", material: "", props: [] }],
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
test("后台页面释放实时连接，可见后刷新重连，晚到刷新与卸载不重建连接", () =>
  domTest(async (_root, dom) => {
    const { mount } = await import("../client/workbench.js");
    const saved = { localStorage: globalThis.localStorage, EventSource: globalThis.EventSource };
    const snap = snapshotFixture(), streams = [];
    let hidden = false, requests = 0, release, app;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    const visibility = (value) => { hidden = value; document.dispatchEvent(new dom.window.Event("visibilitychange")); };
    try {
      globalThis.localStorage = dom.window.localStorage;
      localStorage.setItem("dsh.sessions.current", JSON.stringify({ sessionId: "session-" + crypto.randomUUID() }));
      globalThis.EventSource = class { constructor() { streams.push(this); } close() { this.closed = true; } };
      globalThis.fetch = async () => {
        requests++;
        if (release === null) await new Promise(resolve => { release = resolve; });
        return { ok: true, json: async () => ({ project_id: snap.project.id, snapshot: structuredClone(snap) }) };
      };
      app = mount(); await app.refresh();
      assert.equal(streams.length, 1);
      release = null; const late = app.refresh();
      visibility(true); assert.equal(streams[0].closed, true);
      release(); await late; assert.equal(streams.length, 1);
      const before = requests; await app.refresh(); assert.equal(requests, before);
      snap.runtime.revision++;
      visibility(false); await tick();
      assert.equal(streams.length, 2); assert.equal(app.context.read().runtime.revision, snap.runtime.revision);
      visibility(false); await tick(); assert.equal(streams.length, 2);
      app.dispose(); assert.equal(streams[1].closed, true);
      const disposedRequests = requests; visibility(true); visibility(false); await tick();
      assert.equal(requests, disposedRequests);
    } finally { app?.dispose(); Object.assign(globalThis, saved); }
  }));

test("UI-6 设置选项自动保存、刷新恢复、失败回退，运行中冻结", () =>
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
      const settings = { text: { model: "qwen3.5:27b" }, image: { model: "elysium-image" }, video: { model: "elysium-video" } };
      let fail = false;
      globalThis.fetch = async (url, options = {}) => {
        if (options.method === "POST") {
          if (fail) return { ok: false, json: async () => ({ message: "保存失败" }) };
          const body = JSON.parse(options.body);
          if (url.endsWith("/models")) Object.assign(settings, body.settings);
          else snap.project.output_language = body.command.fields.output_language;
        }
        return { ok: true, json: async () => url.endsWith("/models") ? { settings: structuredClone(settings) } : { project_id: snap.project.id, snapshot: structuredClone(snap) } };
      };
      app = mount();
      await app.refresh();
      app.shell.root.querySelector(".settings").click();
      await tick();
      const content = app.shell.content;
      assert.equal(content.querySelectorAll("select").length, 4);
      assert.equal(content.querySelectorAll("input, textarea").length, 0);
      assert.ok(![...content.querySelectorAll("button")].some(b => b.textContent === "保存"));
      let language = content.querySelector("[name=output_language]"), model = content.querySelector("[name=text]");
      assert.deepEqual([...model.options].map(o => o.textContent), ["接口", "Qwen3.5 27B"]);
      model.value = "elysium-chat";
      await model.onchange();
      assert.equal(settings.text.model, "elysium-chat");
      language.value = "en";
      await language.onchange();
      await tick();
      assert.equal(snap.project.output_language, "en");
      snap.runtime.revision++;
      await app.refresh(); await tick();
      language = content.querySelector("[name=output_language]"); model = content.querySelector("[name=text]");
      assert.equal(language.value, "en"); assert.equal(model.value, "elysium-chat");
      fail = true;
      model.value = "qwen3.5:27b"; await model.onchange();
      assert.equal(model.value, "elysium-chat"); assert.match(content.textContent, /保存失败/);
      language.value = "zh-CN"; await language.onchange();
      assert.equal(language.value, "en");
      snap.tasks = [{ task_status: "running" }]; snap.runtime.revision++;
      await app.refresh(); await tick();
      assert.equal(content.querySelector("[name=output_language]").disabled, true);
      assert.equal(content.querySelector("[name=text]").disabled, true);
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

test("每个人物卡独立提交全部服装，默认头像取首套定妆照", () => domTest(async root => {
  const { emptyCharacterModel } = await import('../shared/models/character_model.js');
  const { emptyCostumeModel } = await import('../shared/models/costume_model.js');
  const { emptyCostumeImageModel } = await import('../shared/models/costume_image_model.js');
  const snapshot = snapshotFixture(), calls = [];
  const outfits = ['常服','礼服'].map(name => emptyCostumeModel({ name }));
  const character = emptyCharacterModel({ name:'甲', costumes:outfits, costume_images:outfits.map(c => emptyCostumeImageModel(c.id)) });
  snapshot.project.character_library.characters = [character];
  globalThis.fetch = async (_url, options) => { calls.push(JSON.parse(options.body).command); return {ok:true,json:async()=>({})}; };
  const context = {session_id:'s',view:{page:'overview'},refresh:async()=>{},onError:assert.fail};
  renderTaskPanel(root,snapshot,context);
  root.querySelector('.character-card').querySelectorAll('button')[1].click(); await tick();
  assert.equal(calls[0].type,'submit-costumes'); assert.equal(calls[0].target_id,character.id); assert.equal(calls[0].action,'generate');
  character.costume_images.forEach((image,index)=>{image.address=`portrait-${index}.png`;image.node_state.status='generated';});
  renderTaskPanel(root,snapshot,context);
  assert.match(root.querySelector('.character-card img').src,/portrait-0.png\?/);
  const generate = root.querySelector('.character-card').querySelectorAll('button')[1];
  assert.equal(generate.textContent,'重新生成定妆照'); generate.click(); await tick();
  assert.equal(calls[1].action,'regenerate');
}));

test('旧提取组内图片失败不冒充提取失败，也不显示已移除流程的继续',()=>domTest(async root=>{
 const snapshot=snapshotFixture();snapshot.project.character_library.node_state.status='generated';
 snapshot.groups=[{id:'legacy',group_type:'workflow'}];
 snapshot.tasks=[{id:'extract',group_id:'legacy',group_seq:1,business_type:'project-characters',task_status:'completed',queue_order:1},{id:'old-image',group_id:'legacy',group_seq:2,business_type:'character-image',task_status:'failed',end_reason:'旧角色图失败',queue_order:2}];
 renderTaskPanel(root,snapshot,{session_id:'s',view:{page:'overview'},refresh:async()=>{},onError:assert.fail});
 const card=[...root.querySelectorAll('.overview-card')].find(card=>card.querySelector('h3')?.textContent==='角色卡');assert.ok(card);
 assert.match(card.textContent,/已通过/);assert.doesNotMatch(card.textContent,/旧角色图失败/);assert.equal([...card.querySelectorAll('button')].some(b=>b.textContent==='继续'),false);
}));
