import { detailsDialog } from "./project-forms.js";
import { element, tabs } from "./panel-dom.js";
import { editor } from "./content-forms.js";
const editIcon =
  '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.7 2.3 13.7 6.3 5.4 14.6H1.4v-4L9.7 2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
export function renderOverview(root, env) {
  const { p, button, act, nodeCard, go, media, labels } = env;
  const view = element("section", "", "project-overview overview-page"),
    heading = element("div", "", "title-with-edit"),
    edit = button("✎", () =>
      detailsDialog(
        root,
        "编辑项目",
        { 名称: p.名称, 画幅: p.画幅 },
        (fields) => act({ type: "edit", fields }, true),
      ),
    );
  edit.className = "icon-edit";
  edit.innerHTML = editIcon;
  edit.setAttribute("aria-label", "编辑标题和画幅");
  const actions = element("div", "", "title-actions");
  const history = button(
      "查看任务历史 →",
      () => go("history", { target_id: null, history_business: null }),
      false,
    ),
    remove = button("删除项目", () => {
      if (globalThis.window.confirm("删除这部短剧及其项目资料？"))
        return act({ type: "delete" }, true);
    });
  history.setAttribute("aria-label", "任务历史");
  history.title = "任务历史";
  history.className = "task-history-entry";
  remove.className = "delete-content";
  remove.setAttribute("aria-label", "删除整个项目");
  remove.title = "删除项目";
  actions.append(history, remove);
  heading.append(element("h2", p.名称), edit, actions);
  view.append(
    element("p", p.创作方式 === "剧本" ? "剧本模式" : "自由模式", "meta"),
    heading,
    element("p", `${p.画幅} · ${p.剧集.length} 集`, "meta"),
  );
  const taskLabels = {
      queued: "排队中",
      running: "生成中",
      completed: "已完成",
      failed: "失败",
      rejected: "未通过",
      cancelled: "已取消",
      superseded: "已作废",
    },
    latestTask = (business) =>
      [...(env.snapshot?.tasks || [])]
        .filter((t) => t.business_type === business && t.target_id === p.id)
        .sort((a, b) => b.queue_order - a.queue_order)[0],
    opinionButton = (submit) =>
      button("按意见修改", () =>
        editor(
          root,
          "按意见修改",
          "",
          (opinion) => {
            if (!opinion.trim()) throw new Error("请输入修改意见");
            return submit(opinion.trim());
          },
          { json: false },
        ),
      ),
    card = (title, statusText) => {
      const c = element("section", "", "overview-card"),
        h = element("div", "", "overview-card-title"),
        titles = element("div", "", "section-titles"),
        actions = element("div", "", "overview-title-actions");
      titles.append(element("h3", title));
      if (statusText)
        titles.append(element("span", statusText, "status-label"));
      h.append(titles, actions);
      c.append(h);
      view.append(c);
      return { c, h, actions };
    };
  if (p.创作方式 === "自由创作") {
    const { c, actions } = card("AI 创作方向");
    const b = button("✎", () =>
      editor(
        root,
        "AI 创作方向",
        p.创作方向,
        (创作方向) => act({ type: "edit", fields: { 创作方向 } }, true),
        { json: false },
      ),
    );
    b.className = "icon-edit";
    b.innerHTML = editIcon;
    b.setAttribute("aria-label", "编辑创作方向");
    actions.append(b);
    c.append(element("p", p.创作方向, "summary summary-preview"));
  }
  const summary = nodeCard("project-summary", p.id, p.项目摘要);
  summary.className = "overview-card";
  summary.querySelector("h3").textContent = "项目大纲";
  summary.querySelector(".prompt")?.classList.add("summary", "summary-preview");
  const summaryActions = summary.querySelector(".workflow-generation-row"),
    manual = [...summaryActions.querySelectorAll("button")].find(
      (b) => b.textContent === "人工编辑",
    ),
    summaryHeading = summary.querySelector(".section-head"),
    summaryTools = element("div", "", "overview-title-actions");
  manual.className = "icon-edit";
  manual.setAttribute("aria-label", "人工编辑");
  manual.title = "人工编辑";
  manual.innerHTML = editIcon;
  summaryHeading.className = "overview-card-title";
  summaryTools.append(manual);
  summaryHeading.append(summaryTools);
  summary.querySelector(".json-copy-row")?.remove();
  view.append(summary);
  const scriptTask = latestTask("script"),
    { c: script, actions: scriptActions } = card(
      "剧本",
      scriptTask
        ? taskLabels[scriptTask.task_status] || scriptTask.task_status
        : "",
    ),
    scriptRow = element("div", "", "script-title-row"),
    open = button(p.名称, () => go("script"), false);
  open.className = "script-file-name";
  const arrow = button("→", () => go("script"), false);
  arrow.className = "script-title-arrow";
  arrow.setAttribute("aria-label", "打开剧本详情");
  scriptRow.append(open, arrow);
  script.append(scriptRow, element("p", `版本 ${p.剧本.版本}`, "meta"));
  if (p.创作方式 === "自由创作") {
    const hasScript = Boolean(p.剧本.正文?.trim()),
      submitScript = (opinion = "") =>
        act({
          type: "submit",
          business_type: "script",
          target_id: p.id,
          action: hasScript ? "regenerate" : "generate",
          ...(opinion ? { opinion } : {}),
        });
    scriptActions.append(
      button(hasScript ? "重新生成" : "AI生成", () => submitScript()),
    );
    if (hasScript && scriptTask?.task_status === "rejected")
      scriptActions.append(opinionButton(submitScript));
  }
  const splitting = p.创作方式 === "剧本",
    splitTask = splitting ? latestTask("script-split") : null,
    { c: episodes, h: episodeHead, actions: episodeActions } = card(
      "剧集",
      splitTask
        ? taskLabels[splitTask.task_status] || splitTask.task_status
        : "",
    );
  episodeHead.classList.add("episode-head");
  // 剧本创作方式由剧本拆分生成剧集；自由创作仍逐集新增。
  const addLabel = splitting
    ? p.剧集.length
      ? "重新拆分剧集"
      : "拆分剧集"
    : "新增剧集";
  const add = button(splitting ? addLabel : "＋ 新增剧集", () => {
    if (splitting) {
      const dialog = detailsDialog(
          root,
          addLabel,
          { 参考单集时长秒: p.参考单集时长秒 },
          async (fields) => {
            dialog.close();
            await act({ type: "edit", fields }, true);
            await act({
              type: "submit",
              business_type: "script-split",
              target_id: p.id,
              action: p.剧集.length ? "regenerate" : "generate",
            });
          },
          { episode: true },
        );
      return dialog;
    }
    return detailsDialog(
          root,
          "新增剧集",
          { 时长秒: 150, 本集要求: "" },
          (fields) => act({ type: "add-episode", fields }, true),
          { episode: true },
        );
  });
  add.className = "episode-add";
  const latestSplitTask = splitting
    ? env.snapshot?.tasks
        .filter(t => t.business_type === "script-split" && t.target_id === p.id)
        .sort((a, b) => b.queue_order - a.queue_order)[0]
    : null;
  if (splitting) {
    if (latestSplitTask?.end_reason) {
      const feedback = element("div", "", "split-task-feedback");
      feedback.setAttribute("aria-live", "polite");
      feedback.append(element("p", latestSplitTask.end_reason, "error"));
      episodes.append(feedback);
    }
  }
  add.setAttribute("aria-label", addLabel);
  episodeActions.append(add);
  if (latestSplitTask)
    episodeActions.append(
      button(
        "查看拆分任务",
        () => go("history", { task_id: latestSplitTask.id, target_id: null, history_business: null }),
        false,
      ),
    );
  const list = element("div", "", "episode-card-list");
  let drag = null, dragged = false;
  list.onpointerdown = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    dragged = false;
    if (list.scrollWidth <= list.clientWidth) return;
    drag = { id: event.pointerId, x: event.clientX, left: list.scrollLeft };
  };
  list.onpointermove = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    if (!dragged && Math.abs(dx) < 5) return;
    if (!dragged) {
      dragged = true;
      list.setPointerCapture(event.pointerId);
      list.classList.add("is-dragging");
    }
    event.preventDefault();
    list.scrollLeft = drag.left - dx;
  };
  const finishDrag = () => {
    if (!drag) return;
    const id = drag.id;
    drag = null;
    list.classList.remove("is-dragging");
    if (list.hasPointerCapture(id)) list.releasePointerCapture(id);
  };
  list.onpointerup = list.onlostpointercapture = finishDrag;
  list.onpointercancel = () => { finishDrag(); dragged = false; };
  list.ondragstart = (event) => event.preventDefault();
  list.addEventListener("click", (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dragged = false;
  }, true);
  episodes.append(list);
  for (const e of [...p.剧集].sort((a, b) => a.序号 - b.序号)) {
    const c = element("article", "", "episode-card");
    c.setAttribute("role", "link");
    c.tabIndex = 0;
    c.onclick = () =>
      go("episode", { episode_id: e.id, shot_id: null, tab: "script" });
    c.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        c.click();
      }
    };
    const cover = element(
      e.封面?.地址 ? "img" : "div",
      e.封面?.地址 ? "" : "封面",
      "episode-cover" + (e.封面?.地址 ? "" : " placeholder"),
    );
    if (e.封面?.地址) {
      cover.src = media(e.封面.地址);
      cover.alt = `第 ${e.序号} 集封面`;
    }
    const copy = element("div", "", "episode-copy"),
      h = element("div", "", "workflow-generation-row episode-card-heading");
    h.append(
      element("strong", `第 ${e.序号} 集`),
      element(
        "span",
        e.实际时长秒 > 0
          ? `参考 ${e.时长秒} 秒 · 实际 ${e.实际时长秒} 秒`
          : `参考 ${e.时长秒} 秒`,
        "meta",
      ),
    );
    copy.append(h, element("p", e.摘要.正文 || "尚未生成摘要"));
    c.append(cover, copy);
    list.append(c);
  }
  if (!p.剧集.length) {
    const empty = element("div", "", "episode-placeholder");
    empty.append(
      element("strong", "还没有剧集"),
      element("p", splitting ? "拆分剧本后开始制作" : "新增剧集后开始制作"),
      button(addLabel, () => add.click()),
    );
    list.append(empty);
  }
  const hasRoles = p.角色库.角色.length > 0,
    extract = (opinion = "") =>
      act({
        type: "submit",
        business_type: "project-characters",
        target_id: p.id,
        action: hasRoles ? "regenerate" : "generate",
        ...(opinion ? { opinion } : {}),
      }),
    { c: library, actions: libraryActions } = card(
      "角色卡",
      labels[p.角色库.状态] || p.角色库.状态,
    ),
    strip = element(
      "div",
      "",
      "characters-strip library-card-strip library-card-strip-characters",
    );
  libraryActions.append(
    button(hasRoles ? "重新生成" : "提取角色", () => extract()),
  );
  if (hasRoles && p.角色库.状态 === "rejected")
    libraryActions.append(opinionButton(extract));
  library.append(strip);
  for (const c of p.角色库.角色) {
    const b = button("", () => go("character", { character_id: c.id }), false);
    b.className = "character-item library-card library-card-characters";
    const image = element(
      c.图片.地址 ? "img" : "div",
      c.图片.地址 ? "" : c.名称.slice(0, 1),
      "library-card-avatar character-image",
    );
    if (c.图片.地址) {
      image.src = media(c.图片.地址);
      image.alt = c.名称;
    }
    const info = element("div", "", "library-card-info");
    info.append(
      element("strong", c.名称),
      element("p", `${c.编号} · ${c.身份}`, "meta"),
    );
    b.append(image, info);
    strip.append(b);
  }
  root.append(view);
}
export function stageTabs(label, entries, selected, change) {
  const row = tabs(label, entries, selected, change);
  row.className = "stage-overview";
  for (const b of row.children) {
    b.className = "stage";
    if (b.getAttribute("aria-selected") === "true")
      b.setAttribute("aria-current", "step");
  }
  return row;
}
export function backHeader(root, title, label, back) {
  const bar = element("div", "", "episode-bar"),
    b = element("button", "←", "episode-back");
  b.setAttribute("aria-label", label);
  b.onclick = back;
  bar.append(b, element("h2", title));
  root.append(bar);
}
export function renderEpisode(root, env, entries) {
  const { p, state, button, act, nodeCard, go, media } = env,
    e = p.剧集.find((e) => e.id === state.episode_id);
  if (!e) return go("overview");
  if (!entries.some(([id]) => id === state.tab)) state.tab = "script";
  const shot = e.镜头表.镜头.find((s) => s.id === state.shot_id);
  backHeader(
    root,
    shot ? `${shot.编号} ${shot.标题}` : `${p.名称} 第 ${e.序号} 集`,
    shot ? "返回镜头" : "返回项目概要",
    () => (shot ? go("episode", { shot_id: null }) : go("overview")),
  );
  const body = element("div", "", "session-body");
  if (shot) {
    body.append(
        element("p", `参考 ${shot.时长秒} 秒${shot.实际时长秒 > 0 ? ` · 实际 ${shot.实际时长秒} 秒` : ""}`, "meta"),
        nodeCard("seconds", shot.id, shot.每秒分镜),
        nodeCard("storyboard", shot.id, shot.文本提示词),
        nodeCard("video", shot.id, shot.视频),
        nodeCard("tail", shot.id, shot.尾帧),
      );
    root.append(body);
    return;
  }
  root.append(
    stageTabs("剧集制作", entries, state.tab, (id) =>
      go("episode", { tab: id, shot_id: null, shotTab: null }),
    ),
  );
  body.append(
    button("编辑本集要求", () =>
      detailsDialog(
        root,
        "编辑剧集",
        { 时长秒: e.时长秒, 本集要求: e.本集要求 },
        (fields) =>
          act({ type: "edit-episode", episode_id: e.id, fields }, true),
        { episode: true },
      ),
    ),
  );
  if (state.tab === "script") {
    const summary = nodeCard("episode-summary", e.id, e.摘要),
      plot = element("section", "", "session-project episode-plot"),
      plotHead = element("div", "", "section-head"),
      plotTitles = element("div", "", "section-titles"),
      plotActions = element("div", "", "workflow-generation-row");
    summary.querySelector("h3").textContent = "本集摘要";
    plotTitles.append(element("h3", "本集剧情"));
    plotHead.append(plotTitles);
    plotActions.append(
      button("编辑剧情", () =>
        detailsDialog(root, "编辑剧情", { 剧情: e.剧情 }, (fields) =>
          act({ type: "edit-episode", episode_id: e.id, fields }, true),
        ),
      ),
    );
    plot.append(
      plotHead,
      element("p", e.剧情 || "尚无剧情", "prompt full"),
      plotActions,
    );
    body.append(
      nodeCard("outline", e.id, e.故事大纲),
      summary,
      plot,
    );
  }
  if (state.tab === "shots") {
    body.append(nodeCard("shots", e.id, e.镜头表));
  }
  if (state.tab === "assembly") body.append(nodeCard("assembly", e.id, e.合片));
  if (["film", "shots"].includes(state.tab)) {
    if (state.tab !== "shots")
      body.append(
        button(
          "生成本集成片",
          () =>
            act({
              type: "submit-group",
              group_type: "episode-film",
              episode_id: e.id,
            }),
        ),
      );
    for (const s of e.镜头表.镜头) {
      const card = element("article", "", "shot-card"),
        h = element("div", "", "outline-head");
      h.append(
        element("h3", `${s.编号} ${s.标题} · ${s.时长秒}s`),
        button(
          "打开镜头",
          () =>
            go("episode", {
              shot_id: s.id,
              shotTab: "film",
            }),
          false,
        ),
      );
      card.append(
        h,
        ...(state.tab === "film" && s.实际时长秒 > 0
          ? [element("p", `实际 ${s.实际时长秒} 秒`, "meta")]
          : []),
        element("p", s.正文, "prompt full"),
      );
      if (state.tab === "film")
        card.append(
          element(
            "p",
            `每秒分镜：${env.labels[s.每秒分镜.状态]} · 文本提示词：${env.labels[s.文本提示词.状态]} · 视频：${env.labels[s.视频.状态]} · 尾帧：${env.labels[s.尾帧.状态]}`,
            "meta",
          ),
        );
      body.append(card);
    }
  }
  root.append(body);
}
