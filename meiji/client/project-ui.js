import { primaryCostumeImage } from "../shared/models/character_model.js";
import { detailsDialog } from "./project-forms.js";
import { element, tabs } from "./panel-dom.js";
import { editor, readable } from "./content-forms.js";
import { historyGroups, groupStatus } from "../shared/task-labels.js";
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
        { name: p.name, aspect_ratio: p.aspect_ratio },
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
    }, false);
  history.setAttribute("aria-label", "任务历史");
  history.title = "任务历史";
  history.className = "task-history-entry";
  remove.className = "delete-content";
  remove.setAttribute("aria-label", "删除整个项目");
  remove.title = "删除项目";
  actions.append(history, remove);
  heading.append(element("h2", p.name), edit, actions);
  view.append(
    element("p", p.creation_mode === "剧本" ? "剧本模式" : "自由模式", "meta"),
    heading,
    element("p", `${p.aspect_ratio} · ${p.episodes.length} 集`, "meta"),
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
    opinionButton = (submit, reason = "") =>
      button("按意见修改", () =>
        editor(
          root,
          "按意见修改",
          reason,
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
      h.append(titles);
      actions.className = "workflow-generation-row";
      c.append(h, actions);
      view.append(c);
      return { c, h, actions };
    };
  if (p.creation_mode === "自由创作") {
    const { c, actions } = card("AI 创作方向");
    const b = button("✎", () =>
      editor(
        root,
        "AI 创作方向",
        p.creative_direction,
        (creative_direction) => act({ type: "edit", fields: { creative_direction } }, true),
        { json: false },
      ),
    );
    b.className = "icon-edit";
    b.innerHTML = editIcon;
    b.setAttribute("aria-label", "编辑创作方向");
    actions.append(b);
    c.append(element("p", p.creative_direction, "summary summary-preview"));
  }
  const summary = nodeCard("project-summary", p.id, p.project_summary);
  summary.className = "overview-card";
  summary.querySelector("h3").textContent = "项目摘要";
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
    open = button(p.name, () => go("script"), false);
  open.className = "script-file-name";
  const arrow = button("→", () => go("script"), false);
  arrow.className = "script-title-arrow";
  arrow.setAttribute("aria-label", "打开剧本详情");
  scriptRow.append(open, arrow);
  script.append(scriptRow, element("p", `版本 ${p.script.version}`, "meta"));
  const splitting = p.creation_mode === "剧本",
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
    ? p.episodes.length
      ? "重新拆分剧集"
      : "拆分剧集"
    : "新增剧集";
  const add = button(splitting ? addLabel : "＋ 新增剧集", () => {
    if (splitting) {
      const dialog = detailsDialog(
          root,
          addLabel,
          { reference_episode_duration_seconds: p.reference_episode_duration_seconds },
          async (fields) => {
            dialog.close();
            await act({ type: "edit", fields }, true);
            await act({
              type: "submit",
              business_type: "script-split",
              target_id: p.id,
              action: p.episodes.length ? "regenerate" : "generate",
            });
          },
          { episode: true },
        );
      return dialog;
    }
    return detailsDialog(
          root,
          "新增剧集",
          { duration_seconds: 150, episode_requirements: "" },
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
  if (!["queued", "running"].includes(latestSplitTask?.task_status)) episodeActions.append(add);
  episodeActions.append(
      button(
        "查看拆分任务",
        () => go("history", { task_id: latestSplitTask?.id || null, target_id: null, history_business: null }),
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
  for (const e of [...p.episodes].sort((a, b) => a.sequence - b.sequence)) {
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
      e.cover ? "img" : "div",
      e.cover ? "" : "封面",
      "episode-cover" + (e.cover ? "" : " placeholder"),
    );
    if (e.cover) {
      cover.src = media(e.cover);
      cover.alt = `第 ${e.sequence} 集封面`;
    }
    const copy = element("div", "", "episode-copy"),
      h = element("div", "", "workflow-generation-row episode-card-heading");
    h.append(
      element("strong", `第 ${e.sequence} 集`),
      element(
        "span",
        e.actual_duration_seconds > 0
          ? `参考 ${e.duration_seconds} 秒 · 实际 ${e.actual_duration_seconds} 秒`
          : `参考 ${e.duration_seconds} 秒`,
        "meta",
      ),
    );
    copy.append(h, element("p", e.summary.body || "尚未生成摘要"));
    c.append(cover, copy);
    list.append(c);
  }
  if (!p.episodes.length) {
    const empty = element("div", "", "episode-placeholder");
    empty.append(
      element("strong", "还没有剧集"),
      element("p", splitting ? "拆分剧本后开始制作" : "新增剧集后开始制作"),
      button(addLabel, () => add.click()),
    );
    list.append(empty);
  }
  const roleGroup = env.snapshot && historyGroups({ ...env.snapshot,
      groups: env.snapshot.groups.filter(group => group.group_type === "workflow"),
    }).find(({ tasks }) => tasks.some(task =>
        task.business_type === "project-characters")),
    extraction = roleGroup && groupStatus(roleGroup.tasks.filter(task => task.business_type === "project-characters")),
    roleStatus = extraction?.status || p.character_library.node_state.status,
    hasRoles = p.character_library.characters.length > 0,
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
      labels[roleStatus] || ({ queued: "排队中", completed: "已通过", superseded: "已作废" })[roleStatus] || roleStatus,
    ),
    strip = element(
      "div",
      "",
      "characters-strip library-card-strip library-card-strip-characters",
    );
  if (roleGroup && ["failed", "rejected", "cancelled", "superseded"].includes(roleStatus) &&
      roleGroup.tasks.every(task => !["queued", "running"].includes(task.task_status)))
    libraryActions.append(button("继续", () => act({ type: "continue-group", group_id: roleGroup.group.id })));
  if (!["queued", "running"].includes(roleStatus)) libraryActions.append(
    button(hasRoles ? "重新生成" : "AI生成", () => extract()),
  );
  libraryActions.append(button("查看任务历史", () => go("history", { target_id: p.id, history_business: "project-characters" }), false));
  const roleReason = extraction ? extraction.reason : p.character_library.node_state.reason;
  if (roleReason) library.append(element("p", roleReason, "error"));
  if (hasRoles && p.character_library.node_state.status === "rejected")
    libraryActions.append(opinionButton(extract, p.character_library.node_state.reason));
  library.append(strip);
  for (const c of p.character_library.characters) {
    const b = button("", () => go("character", { character_id: c.id }), false);
    b.className = "character-item library-card library-card-characters";
    const primary = primaryCostumeImage(c);
    const image = element(
      primary.address ? "img" : "div",
      primary.address ? "" : c.name.slice(0, 1),
      "library-card-avatar character-image",
    );
    if (primary.address) {
      image.src = media(primary.address);
      image.alt = c.name;
    }
    const info = element("div", "", "library-card-info");
    info.append(
      element("strong", c.name),
      element("p", `${c.number} · ${c.position}`, "meta"),
    );
    b.append(image, info);
    const card = element("article", "", "character-card");
    const ready = c.costume_images.filter(image => c.costumes.length ? c.costumes.some(co => co.id === image.costume_id) : image.costume_id === "");
    const regenerate = ready.length > 0 && ready.every(image => image.address);
    const generate = button(regenerate ? "重新生成定妆照" : "生成定妆照", () => act({
      type: "submit-costumes", target_id: c.id, action: regenerate ? "regenerate" : "generate",
    }));
    card.append(b, generate); strip.append(card);
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
    e = p.episodes.find((e) => e.id === state.episode_id);
  if (!e) return go("overview");
  if (!entries.some(([id]) => id === state.tab)) state.tab = "script";
  const shot = e.shot_list.shots.find((s) => s.id === state.shot_id);
  backHeader(
    root,
    shot ? `${shot.number} ${shot.title}` : `${p.name} 第 ${e.sequence} 集`,
    shot ? "返回镜头" : "返回项目概要",
    () => (shot ? go("episode", { shot_id: null }) : go("overview")),
  );
  const body = element("div", "", "session-body");
  if (shot) {
    body.append(
        element("p", `参考 ${shot.duration_seconds} 秒${shot.actual_duration_seconds > 0 ? ` · 实际 ${shot.actual_duration_seconds} 秒` : ""}`, "meta"),
        nodeCard("shot-characters", shot.id, shot.character_binding),
        nodeCard("seconds", shot.id, shot.seconds_storyboard),
        nodeCard("storyboard", shot.id, shot.text_to_video_prompt),
        nodeCard("video", shot.id, shot.video),
        nodeCard("tail", shot.id, shot.last_frame),
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
        { duration_seconds: e.duration_seconds, episode_requirements: e.episode_requirements },
        (fields) =>
          act({ type: "edit-episode", episode_id: e.id, fields }, true),
        { episode: true },
      ),
    ),
  );
  if (state.tab === "script") {
    const summary = nodeCard("episode-summary", e.id, e.summary),
      plot = element("section", "", "session-project episode-plot"),
      plotHead = element("div", "", "section-head"),
      plotTitles = element("div", "", "section-titles"),
      plotActions = element("div", "", "workflow-generation-row");
    summary.querySelector("h3").textContent = "本集摘要";
    plotTitles.append(element("h3", "本集剧情"));
    plotHead.append(plotTitles);
    plotActions.append(
      button("编辑剧情", () =>
        detailsDialog(root, "编辑剧情", { plot: e.plot }, (fields) =>
          act({ type: "edit-episode", episode_id: e.id, fields }, true),
        ),
      ),
    );
    plot.append(
      plotHead,
      element("p", e.plot || "尚无剧情", "prompt full"),
      plotActions,
    );
    body.append(
      nodeCard("outline", e.id, e.story_outline),
      summary,
      plot,
    );
  }
  if (state.tab === "shots") {
    body.append(nodeCard("shots", e.id, e.shot_list));
  }
  if (state.tab === "assembly") body.append(nodeCard("assembly", e.id, e.assembly));
  if (["film", "shots"].includes(state.tab)) {
    if (state.tab !== "shots")
      body.append(
        button(
          e.shot_list.shots.some(shot => shot.video.address) ? "重新生成本集成片" : "生成本集成片",
          () =>
            act({
              type: "submit-group",
              group_type: "episode-film",
              action: e.shot_list.shots.some(shot => shot.video.address) ? "regenerate" : "generate",
              episode_id: e.id,
            }),
        ),
      );
    for (const s of [...e.shot_list.shots].sort((a, b) => a.sequence - b.sequence)) {
      const card = element("article", "", "shot-card"),
        h = element("div", "", "outline-head");
      h.append(
        element("h3", `${s.number} ${s.title} · ${s.duration_seconds}s`),
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
        ...(state.tab === "film" && s.actual_duration_seconds > 0
          ? [element("p", `实际 ${s.actual_duration_seconds} 秒`, "meta")]
          : []),
        element("p", s.body, "prompt full"),
      );
      if (state.tab === "shots")
        card.append(element("p", readable({
          shot_scale: s.shot_scale, hook: s.hook, continuity_transition: s.continuity_transition,
          reference_anchor: s.reference_anchor, audio_arrangement: s.audio_arrangement,
        }), "prompt full"));
      if (state.tab === "film")
        card.append(
          element(
            "p",
            `角色识别：${env.labels[s.character_binding.node_state.status]} · 每秒分镜：${env.labels[s.seconds_storyboard.node_state.status]} · 文本提示词：${env.labels[s.text_to_video_prompt.node_state.status]} · 视频：${env.labels[s.video.node_state.status]} · 尾帧：${env.labels[s.last_frame.node_state.status]}`,
            "meta",
          ),
        );
      body.append(card);
    }
  }
  root.append(body);
}
