import { BUSINESS_DEFINITIONS } from '../shared/node-definitions.js';
import { latestNodeTask, taskStatusRow, taskFailureRow, repairButtonLabel, revisionNote, reasonParagraph } from './node-task-status.js';
import { primaryCostumeImage } from "../shared/models/character_model.js";
import { nodeOf } from "../shared/task_contract.js";
import { detailsDialog } from "./project-forms.js";
import { element, tabs } from "./panel-dom.js";
import { editor, readable } from "./content-forms.js";
import { historyGroups } from "../shared/task-labels.js";
import { videoType } from "../shared/video-inputs.js";
const groupLabels = {
  empty: "未生成", queued: "排队中", running: "生成中", completed: "已通过",
  failed: "失败", rejected: "未通过", cancelled: "已取消", superseded: "已取消",
};
function stoppedNodeMessage(project, tasks) {
  const stopped = tasks.find((task) => ["failed", "rejected", "cancelled"].includes(task.task_status));
  if (!stopped) return "";
  let node = null;
  try { node = nodeOf(project, stopped.business_type, stopped.target_id); } catch { node = null; }
  if (stopped.task_status === "failed" || stopped.task_status === "cancelled") return stopped.end_reason || "";
  return node?.node_state.reason || stopped.end_reason || "";
}
function groupStopMessage(project, group) {
  return ["failed", "rejected", "cancelled"].includes(group?.status) ? stoppedNodeMessage(project, group.tasks) : "";
}
function canResumeGroup(entry, groups) {
  if (!entry || entry.tasks.some(task => BUSINESS_DEFINITIONS[task.business_type]?.retired && task.task_status !== "completed")) return false;
  const newer = groups.some((row) => row.group.id !== entry.group.id && row.tasks.some((task) => entry.tasks.some((old) => old.business_type === task.business_type && old.target_id === task.target_id && task.queue_order > old.queue_order)));
  return !newer && ["failed", "rejected", "cancelled", "superseded"].includes(entry.status) && entry.tasks.every((task) => !["queued", "running"].includes(task.task_status));
}
function unfinishedGroupTasks(tasks) {
  return (tasks || [])
    .filter((task) => ["queued", "running"].includes(task.task_status))
    .sort((a, b) => (a.group_seq ?? 0) - (b.group_seq ?? 0) || (a.queue_order ?? 0) - (b.queue_order ?? 0));
}
function groupButtons(button, act, { ready, busy, resume, tasks, onPrimary, onResume, onHistory }) {
  const items = [];
  if (!busy) items.push(button(ready ? "重新生成" : "一键生成", onPrimary));
  if (resume) items.push(button("继续", onResume));
  items.push(button("任务历史", onHistory, false));
  const pending = unfinishedGroupTasks(tasks);
  if (pending.length) items.push(button("取消", async () => {
    await act({ type: "cancel", task_id: pending[0].id });
  }, false));
  return items;
}
function tailStep(shot, { button, act, media }) {
  const frame = shot.last_frame;
  const step = element("section", "", "tail-step");
  const labels = {
    empty: "未生成", generated: "已生成", rejected: "未通过", expired: "已过期",
  };
  step.dataset.business = "tail";
  step.append(element("p", `尾帧 · ${labels[frame.node_state.status] || frame.node_state.status}`, "meta"));
  if (frame.address) {
    const image = element("img");
    image.src = media(frame.address);
    image.alt = "尾帧";
    image.style.maxWidth = "100%";
    step.append(image);
  }
  if (shot.video.address && !frame.address) {
    step.append(button("重新提取", () => act({
      type: "manual-edit",
      business_type: "video",
      target_id: shot.id,
      content: { address: shot.video.address },
    })));
  }
  return step;
}
function groupCard(title, status, message, buttons) {
  const card = element("section", "", "session-project"),
    head = element("div", "", "section-head");
  head.append(element("h3", title));
  card.append(head, taskGroupUi(status, message, buttons));
  return card;
}
const nodeStatusLabels = { empty: "未生成", generated: "已生成", rejected: "未通过", expired: "已过期" };
function stepTone(status) {
  if (status === "generated") return "done";
  if (status === "rejected" || status === "expired") return "failed";
  return "empty";
}
function packNode(episode, shot) {
  const type = shot.video_generation_type || videoType(episode, shot);
  if (type === "首尾帧") return ["首尾帧", shot.first_last_frame_prompt];
  if (type === "多模态") return ["多模态", shot.multimodal_prompt];
  if (type === "文生") return ["文生", { node_state: { status: "generated" }, prompt: "文生，不编排额外提示词" }];
  return ["多模态/首尾帧", { node_state: { status: "empty" }, prompt: "" }];
}
function filmNodes(episode, shot) {
  return [
    ["每秒分镜", shot.seconds_storyboard],
    ["文本提示词", shot.text_to_video_prompt],
    packNode(episode, shot),
    ["视频", shot.video],
  ];
}
function shotFilmEntry(listed, episode, shot) {
  return listed.find((row) => row.group.group_type === "episode-film" && row.group.episode_id === episode.id && row.group.shot_ids?.length === 1 && row.group.shot_ids[0] === shot.id);
}
function taskGroupUi(status, message, buttons) {
  const ui = element("div", "", "task-group-ui"),
    row = element("div", "", "workflow-generation-row");
  row.append(element("p", groupLabels[status] || status, "node-ui-status"));
  for (const item of buttons) row.append(item);
  ui.append(row);
  if (message) ui.append(element("p", message, "error"));
  return ui;
}
function shotStepRow(episode, shot) {
  const row = element("ol", "", "shot-steps");
  filmNodes(episode, shot).forEach(([name, node], index) => {
    const status = node?.node_state?.status || "empty";
    const item = element("li", "", `shot-step is-${stepTone(status)}`);
    item.title = nodeStatusLabels[status] || status;
    const badge = element("span", "", "shot-step-index");
    badge.append(element("span", String(index + 1)));
    item.append(badge, element("span", name, "shot-step-name"));
    row.append(item);
  });
  return row;
}
function shotScript(shot) {
  const block = element("div", "", "shot-body");
  block.append(element("h4", "本镜内容"), element("p", shot.body || "尚无本镜内容", "prompt"));
  if (shot.actual_duration_seconds > 0) block.append(element("p", `实际 ${shot.actual_duration_seconds} 秒`, "meta"));
  return block;
}
function clipPreview(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "未生成";
  return value.length > 140 ? `${value.slice(0, 140)}…` : value;
}
function shotResultText(project, name, node) {
  if (name === "角色识别") {
    if (!node?.has_result) return "尚未识别";
    if (!node.on_screen_characters.length) return node.node_state.status === "generated" ? "已确认无人出镜" : "候选：无人出镜";
    return node.on_screen_characters.map((row) => {
      const person = project.character_library.characters.find((item) => item.id === row.character_id);
      const costume = person?.costumes.find((item) => item.id === row.costume_id);
      if (!person) return "未知角色";
      return costume ? `${person.name}·${costume.name}` : person.name;
    }).join("、");
  }
  if (name === "每秒分镜") {
    const beat = node.storyboard?.[0];
    return clipPreview([beat?.time_range, beat?.action].filter(Boolean).join(" ") || node.end_state);
  }
  if (name === "文本提示词") return clipPreview(node.integrated_multimodal_description);
  if (name === "文生") return "文生，不编排额外提示词";
  if (name === "多模态/首尾帧") return "待判断";
  if (name === "首尾帧" || name === "多模态") return clipPreview(node.prompt);
  return "未生成";
}
function shotResultStrip(project, episode, shot, media) {
  const strip = element("div", "", "shot-results");
  for (const [name, node] of filmNodes(episode, shot)) {
    const card = element("article", "", "shot-result");
    const status = node?.node_state?.status || "empty";
    card.append(element("h4", name, `is-${stepTone(status)}`));
    if (name === "视频" && node.address) {
      const video = element("video");
      video.src = media(node.address);
      video.muted = true;
      video.preload = "metadata";
      video.setAttribute("aria-label", `${shot.number} 视频预览`);
      card.append(video);
    } else card.append(element("p", shotResultText(project, name, node)));
    strip.append(card);
  }
  return strip;
}
const editIcon =
  '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.7 2.3 13.7 6.3 5.4 14.6H1.4v-4L9.7 2.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
// 横向卡片列表：鼠标拖动滚动，拖动后不触发卡片点击；触控沿用原生滑动。
function dragScroll(list) {
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
}

export function renderOverview(root, env) {
  const { p, button, act, nodeCard, go, media, labels, state } = env;
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
      superseded: "已取消",
    },
    latestTask = (business) =>
      [...(env.snapshot?.tasks || [])]
        .filter((t) => t.business_type === business && t.target_id === p.id)
        .sort((a, b) => b.queue_order - a.queue_order)[0],
    card = (title, statusText) => {
      const c = element("section", "", "overview-card"),
        h = element("div", "", "overview-card-title"),
        titles = element("div", "", "section-titles"),
        actions = element("div", "", "overview-title-actions");
      titles.append(element("h3", title));
      h.append(titles);
      actions.className = "workflow-generation-row";
      if (statusText) actions.append(element("p", statusText, "node-ui-status"));
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
  summary.querySelector(".section-head").className = "overview-card-title";
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
  script.append(scriptRow);
  // 剧本本身是节点，审核与修改都是它的任务：剧本的有无即其数据状态，不展示状态标签；公共节点 UI 放在剧本信息下方。
  if (p.script.body.trim()) {
    const node = nodeCard("script-review", p.id, p.script);
    script.dataset.business = "script-review";
    script.append(...node.querySelectorAll(":scope > .node-ui"));
  }
  const splitting = p.creation_mode === "剧本",
    latestSplitTask = splitting ? latestNodeTask(env.snapshot?.tasks || [], "script-split", p.id) : null,
    { c: episodes, actions: episodeActions } = card("剧集");
  episodeActions.remove();
  const episodeUi = element("div", "", "node-ui"),
    episodeRow = element("div", "", "workflow-generation-row"),
    episodeButtons = element("div", "", "node-ui-buttons"),
    splitBusy = ["queued", "running"].includes(latestSplitTask?.task_status),
    splitStatus = p.episodes.length ? "generated" : "empty";
  episodes.querySelector(".section-titles").append(element("span", labels[splitStatus] || splitStatus, "node-data-tag"));
  const splitTaskRow = taskStatusRow(latestSplitTask);
  const splitRound = revisionNote(latestSplitTask, env.snapshot?.steps, BUSINESS_DEFINITIONS["script-split"]?.retryRounds);
  if (splitTaskRow && splitRound) splitTaskRow.textContent += ` · ${splitRound}`;
  let add = null, addLabel = "";
  if (splitting) {
    addLabel = p.episodes.length ? "重新生成" : "AI生成";
    if (!splitBusy) {
      add = button(addLabel, () => {
        const dialog = detailsDialog(
          root,
          addLabel,
          { reference_episode_duration_seconds: p.reference_episode_duration_seconds },
          async (fields) => {
            dialog.close();
            const key = `script-split:${p.id}`;
            const text = (state.opinions?.[key] || "").trim();
            if (text) {
              state.opinionPending ??= {};
              state.opinionPending[key] = true;
            }
            await act({ type: "edit", fields }, true);
            await act({
              type: "submit",
              business_type: "script-split",
              target_id: p.id,
              action: p.episodes.length ? "regenerate" : "generate",
              ...(text ? { opinion: text } : {}),
            });
          },
          { episode: true },
        );
        return dialog;
      });
      add.setAttribute("aria-label", addLabel);
      episodeButtons.append(add);
    }
  } else {
    addLabel = "＋ 新增剧集";
    add = button(addLabel, () =>
      detailsDialog(
        root,
        "新增剧集",
        { duration_seconds: 150 },
        (fields) => act({ type: "add-episode", fields }, true),
        { episode: true },
      ));
    add.className = "episode-add";
    add.setAttribute("aria-label", "新增剧集");
    episodeButtons.append(add);
  }
  if (splitting && !splitBusy && latestSplitTask?.task_status === "rejected") {
    episodeButtons.append(button("人工放行", () => act({
      type: "override", business_type: "script-split", target_id: p.id,
    })));
  }
  if (splitting) {
    episodeButtons.append(button(
      "任务历史",
      () => go("history", { task_id: latestSplitTask?.id || null, target_id: null, history_business: null }),
      false,
    ));
    if (splitBusy) episodeButtons.append(button("取消", () => act({ type: "cancel", task_id: latestSplitTask.id }), false));
  }
  if (splitting) episodeButtons.append(button('查看规则', () => env.openRules('script-split', p.id), false));
  episodeRow.append(episodeButtons);
  if (splitTaskRow) episodeRow.append(splitTaskRow);
  episodeUi.append(episodeRow);
  if (splitting) {
    const opinionKey = `script-split:${p.id}`;
    if (
      state.opinionPending?.[opinionKey] &&
      latestSplitTask?.task_status === "completed" &&
      !(env.snapshot?.tasks || []).some((task) =>
        task.business_type === "script-split" &&
        task.target_id === p.id &&
        ["queued", "running"].includes(task.task_status),
      )
    ) {
      state.opinions ??= {};
      delete state.opinions[opinionKey];
      delete state.opinionPending[opinionKey];
    }
    state.opinions ??= {};
    const opinion = element("input", "", "node-ui-opinion");
    opinion.placeholder = "本次执行意见";
    opinion.setAttribute("aria-label", "本次执行意见");
    opinion.value = state.opinions[opinionKey] || "";
    opinion.oninput = () => { state.opinions[opinionKey] = opinion.value; };
    episodeUi.append(opinion);
    const failureRow = taskFailureRow(latestSplitTask);
    if (failureRow) episodeUi.append(failureRow);
    if (latestSplitTask?.task_status === "rejected" && latestSplitTask.end_reason) {
      episodeUi.append(reasonParagraph(`未通过原因：${latestSplitTask.end_reason}`));
      // 提取剧集没有项目节点，未通过候选只在任务历史；修复始终修订该候选，不要求已有正式剧集。
      if (!splitBusy) {
        const repair = element("div", "", "node-ui-buttons node-ui-repair-row");
        repair.append(button(repairButtonLabel("script-split"), () => {
          const typed = (state.opinions?.[opinionKey] || "").trim();
          if (typed) {
            state.opinionPending ??= {};
            state.opinionPending[opinionKey] = true;
          }
          return act({
            type: "submit",
            business_type: "script-split",
            target_id: p.id,
            action: "revise",
            opinion: [latestSplitTask.end_reason.trim(), typed].filter(Boolean).join("\n"),
          });
        }));
        episodeUi.append(repair);
      }
    }
  }
  episodes.append(episodeUi);
  const list = element("div", "", "episode-card-list");
  dragScroll(list);
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
    );
    if (add) empty.append(button(addLabel, () => add.click()));
    list.append(empty);
  }
  const people = nodeCard("project-characters", p.id, p.character_library);
  people.querySelector("h3").textContent = "提取人物";
  const strip = element("div", "", "characters-strip library-card-strip library-card-strip-characters");
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
    info.append(element("strong", c.name), element("p", c.position, "meta"));
    b.append(image, info);
    strip.append(b);
  }
  people.append(strip);
  view.append(people);
  const groups = env.snapshot ? historyGroups(env.snapshot) : [];
  const costumeGroup = groups.find((row) => row.tasks.some((task) => task.business_type === "costume-image"));
  const costumeReady = p.character_library.characters.some((character) => character.costume_images.some((image) => image.address));
  const costumeBusy = costumeGroup?.tasks.some((task) => ["queued", "running"].includes(task.task_status));
  const costumeButtons = groupButtons(button, act, {
    ready: costumeReady,
    busy: costumeBusy,
    resume: canResumeGroup(costumeGroup, groups),
    tasks: costumeGroup?.tasks,
    onPrimary: () => act({ type: "submit-costumes", action: costumeReady ? "regenerate" : "generate" }),
    onResume: () => act({ type: "continue-group", group_id: costumeGroup.group.id }),
    onHistory: () => go("history", { history_business: "costume-image" }),
  });
  view.append(groupCard(
    "生成定妆照",
    costumeGroup?.status || "empty",
    groupStopMessage(p, costumeGroup),
    costumeButtons,
  ));
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
    const video = nodeCard('video', shot.id, shot.video);
    video.append(tailStep(shot, { button, act, media }));
    body.append(
        element("p", `参考 ${shot.duration_seconds} 秒${shot.actual_duration_seconds > 0 ? ` · 实际 ${shot.actual_duration_seconds} 秒` : ""}`, "meta"),
        nodeCard("seconds", shot.id, shot.seconds_storyboard),
        nodeCard("storyboard", shot.id, shot.text_to_video_prompt),
        element('p', '视频类型：' + (shot.video_generation_type || '待视频任务执行时确定'), 'meta'),
        ...(shot.video_generation_type === '首尾帧' ? [nodeCard('first-last-frame', shot.id, shot.first_last_frame_prompt)] : shot.video_generation_type === '多模态' ? [nodeCard('multimodal', shot.id, shot.multimodal_prompt)] : []),
        video,
      );
    root.append(body);
    return;
  }
  root.append(
    stageTabs("剧集制作", entries, state.tab, (id) =>
      go("episode", { tab: id, shot_id: null, shotTab: null }),
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
        detailsDialog(root, "编辑剧情", { plot: e.plot, duration_seconds: e.duration_seconds }, (fields) =>
          act({ type: "edit-episode", episode_id: e.id, fields }, true),
        ),
      ),
    );
    plot.append(
      plotHead,
      element("p", e.plot || "尚无剧情", "prompt full"),
      plotActions,
    );
    const scenesNode = nodeCard("episode-scenes", e.id, e.scene_catalog);
    const scenes = e.scene_catalog.scene_ids
      .map((id) => p.scene_library.scenes.find((item) => item.id === id))
      .filter(Boolean);
    if (scenes.length) {
      // 本集场景横向排列，一屏两张，可左右滑动。
      const list = element("div", "", "scene-card-list");
      // 参考图缩略图采用项目视频画幅；原图比例不同时按画幅框裁切，点击放大看原图。
      const [frameW, frameH] = String(p.aspect_ratio || "768x1344").split("x").map(Number);
      list.style.setProperty("--scene-aspect", `${frameW} / ${frameH}`);
      list.dataset.orientation = frameH > frameW ? "portrait" : "landscape";
      dragScroll(list);
      for (const scene of scenes) {
        const card = element("section", "", "session-project scene-setting");
        card.dataset.sceneId = scene.id;
        card.append(
          element("h3", scene.name),
          element("p", [scene.description, scene.layout, scene.materials, scene.lighting].filter(Boolean).join("\n"), "prompt full"),
          nodeCard("scene-image", scene.id, scene.reference_image),
        );
        card.querySelector('[data-business="scene-image"] img')?.classList.add("scene-thumb");
        list.append(card);
      }
      scenesNode.append(list);
    }
    body.append(
      nodeCard("outline", e.id, e.story_outline),
      scenesNode,
      summary,
      plot,
    );
  }
  if (state.tab === "shots") {
    body.append(nodeCard("shots", e.id, e.shot_list));
  }
  if (state.tab === "assembly") body.append(nodeCard("assembly", e.id, e.assembly));
  if (["film", "shots"].includes(state.tab)) {
    const listed = historyGroups(env.snapshot);
    if (state.tab !== "shots") {
      const filmGroup = listed.find((row) => row.group.group_type === "episode-film" && row.group.episode_id === e.id);
      const hasVideo = e.shot_list.shots.some((shot) => shot.video.address);
      const filmBusy = filmGroup?.tasks.some((task) => ["queued", "running"].includes(task.task_status));
      const filmButtons = groupButtons(button, act, {
        ready: hasVideo,
        busy: filmBusy,
        resume: canResumeGroup(filmGroup, listed),
        tasks: filmGroup?.tasks,
        onPrimary: () => act({
          type: "submit-group", group_type: "episode-film",
          action: hasVideo ? "regenerate" : "generate", episode_id: e.id,
        }),
        onResume: () => act({ type: "continue-group", group_id: filmGroup.group.id }),
        onHistory: () => go("history", { history_episode: e.id }),
      });
      body.append(groupCard(
        "逐镜头成片",
        filmGroup?.status || "empty",
        groupStopMessage(p, filmGroup),
        filmButtons,
      ));
    }
    for (const s of [...e.shot_list.shots].sort((a, b) => a.sequence - b.sequence)) {
      const card = element("article", "", "shot-card"),
        h = element("div", "", "outline-head"),
        title = element("div", "", "shot-card-title");
      title.append(element("h3", `${s.number} ${s.title} · ${s.duration_seconds}s`));
      const scene = p.scene_library.scenes.find(item => item.id === s.scene_id);
      title.append(element('p',scene ? `场景：${scene.name} · ${s.scene_state || '基础状态'} · ${s.scene_transition}` : '场景：本镜描述（无需独立参考图）','meta'));
      h.append(title);
      if (state.tab === "film") h.append(
        button(
          "查看详情",
          () =>
            go("episode", {
              shot_id: s.id,
              shotTab: "film",
            }),
          false,
        ),
      );
      const shotGroup = state.tab === "film" ? shotFilmEntry(listed, e, s) : null;
      const shotReady = Boolean(s.video.address);
      const shotBusy = Boolean(shotGroup?.tasks.some((task) => ["queued", "running"].includes(task.task_status)));
      card.append(
        h,
        ...(state.tab === "film" ? [
          taskGroupUi(
            shotGroup?.status || "empty",
            groupStopMessage(p, shotGroup),
            groupButtons(button, act, {
              ready: shotReady,
              busy: shotBusy,
              resume: canResumeGroup(shotGroup, listed),
              tasks: shotGroup?.tasks,
              onPrimary: () => act({
                type: "submit-group", group_type: "episode-film",
                action: shotReady ? "regenerate" : "generate", episode_id: e.id, shot_id: s.id,
              }),
              onResume: () => act({ type: "continue-group", group_id: shotGroup.group.id }),
              onHistory: () => go("history", { history_episode: e.id }),
            }),
          ),
          shotStepRow(e, s),
          shotScript(s),
          shotResultStrip(p, e, s, media),
        ] : []),
      );
      if (state.tab === "shots") {
        const details = element("div", "", "shot-details prompt full");
        details.append(element("p", readable({
          body: s.body,
          shot_scale: s.shot_scale, hook: s.hook, continuity_transition: s.continuity_transition,
          reference_anchor: s.reference_anchor, audio_arrangement: s.audio_arrangement,
        }), "shot-details-text"));
        details.append(shotCastDetails(p, s));
        card.append(details);
      }
      body.append(card);
    }
  }
  root.append(body);
}

export function shotCastDetails(project, shot) {
  const entries = shot.on_screen_characters.map(row => {
    const person = project.character_library.characters.find(person => person.id === row.character_id);
    const costume = person.costumes.find(costume => costume.id === row.costume_id);
    const description = costume ? [costume.description, costume.color && `颜色：${costume.color}`,
      costume.material && `材质：${costume.material}`, costume.props.length && `道具：${costume.props.join("、")}`].filter(Boolean).join("；") : '';
    return `角色：${person.name} 服装：${costume?.name || '未指定服装'} 服装描述：${description || '未明确'}。`;
  });
  if (shot.background_characters) entries.push(`不具名群演：${shot.background_characters}`);
  const line = element('p', `出镜人物与服装：【${entries.join(' ') || '无卡内人物及群演'}】`, 'shot-cast');
  line.setAttribute('aria-label', '出镜人物与服装');
  return line;
}
