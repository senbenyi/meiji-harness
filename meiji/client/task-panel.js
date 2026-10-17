import { sceneCatalog } from '../shared/scene-inputs.js';
import { latestNodeTask, taskStatusRow, taskFailureRow, repairButtonLabel, revisionNote, reasonParagraph } from './node-task-status.js';
import { NODE_DEFINITIONS } from '../shared/node-definitions.js';
import { shotSceneSetup } from '../shared/shot-text-inputs.js';
import { editor, fieldLabels, readable } from "./content-forms.js";
import { renderOverview, renderEpisode, backHeader, shotCastDetails } from "./project-ui.js";
import { renderResource, blankCharacter } from "./resource-ui.js";
import { renderHistory } from "./history-ui.js";
import { renderSkillDetail } from './skill-detail.js';
import { element, showPanelDialog, showImagePreview, appendJsonCopy } from "./panel-dom.js";
import { sendCommand, request } from "./task-client.js";
const labels = {
  empty: "未生成",
  generated: "已生成",
  rejected: "未通过",
  expired: "已过期",
};
export const episodeTabs = [
  ["script", "剧情"],
  ["shots", "镜头表"],
  ["film", "成片"],
  ["assembly", "合成"],
];
function blockingDialog(root, message) {
  const dialog = element("dialog", "", "blocking-reason"),
    title = element("h3", "操作暂时无法执行"),
    body = element("p", message),
    footer = element("div", "", "footer"),
    close = element("button", "知道了", "primary");
  dialog.setAttribute("aria-label", title.textContent);
  close.type = "button";
  close.onclick = () => dialog.close();
  footer.append(close);
  dialog.append(title, body, footer);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  root.append(dialog);
  showPanelDialog(dialog);
  close.focus();
}
const names = {
  "script-review": "剧本",
  "project-summary": "项目摘要",
  "project-characters": "角色库",
  "episode-summary": "展示摘要",
  "episode-scenes": "提取场景", "scene-image": "场景参考图",
  outline: "故事大纲",
  "script-split": "拆分剧集",
  shots: "镜头表",
  seconds: "每秒分镜",
  storyboard: "文本提示词",
  video: "视频",
  tail: "尾帧", 'first-last-frame': '首尾帧参数编排', multimodal: '多模态参数编排',
  assembly: "合片",
  "character-image": "角色图片",
  "costume-image": "角色定妆照",
};
function payload(node) {
  const walk = (value) => Array.isArray(value) ? value.map(walk)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["id", "node_state", "script_version", "character_image", "costume_images", "reference_image"].includes(key))
      .map(([key, child]) => [key, walk(child)])) : value;
  return walk(node);
}
function labeledLines(source, keys) {
  return keys.flatMap((key) => {
    const text = String(source?.[key] ?? "").trim();
    return text ? [[fieldLabels[key] || key, text]] : [];
  });
}
function secondsView(node) {
  const view = element("div", "", "seconds-beats");
  for (const beat of node.storyboard || []) {
    const block = element("section", "", "seconds-beat");
    for (const [label, text] of labeledLines(beat, ["time_range", "action", "camera", "space", "audio", "handoff"]))
      block.append(element("p", `${label}：${text}`));
    for (const line of beat.dialogue || [])
      for (const [label, text] of labeledLines(line, ["speaker_name", "mode", "dialogue_text"]))
        block.append(element("p", `${label}：${text}`));
    if (block.childElementCount) view.append(block);
  }
  const summary = element("section", "", "seconds-summary");
  for (const [label, text] of labeledLines(node, ["end_state", "pending_actions", "pending_dialogue", "continuing_audio"]))
    summary.append(element("p", `${label}：${text}`));
  if (summary.childElementCount) view.append(summary);
  return view;
}
function hasContent(value) {
  if (value?.has_result === true) return true;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasContent);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    !["id", "node_state", "script_version", "number", "sequence", "duration_seconds", "actual_duration_seconds", "costume_id"].includes(key) && hasContent(child));
}
export function renderSettings(root, { busy = false, settings, saveSettings, back }) {
  const page = element("section", "", "settings-page"),
    backButton = element("button", "← 返回"),
    group = element("section", "", "settings-group"),
    language = element("select"),
    label = element("label", "生成语言", "settings-option"),
    message = element("p", "", "error settings-error");
  backButton.type = "button";
  backButton.onclick = back;
  message.setAttribute("role", "status");
  language.name = "output_language";
  language.setAttribute("aria-label", "生成语言");
  for (const [value, text] of [["zh-CN", "简体中文"], ["en", "English（英文）"]]) {
    const option = element("option", text);
    option.value = value;
    language.append(option);
  }
  language.value = settings?.output_language || "zh-CN";
  language.dataset.saved = language.value;
  language.disabled = busy || !settings;
  language.onchange = async () => {
    const previous = language.dataset.saved;
    language.disabled = true;
    message.textContent = "";
    try {
      await saveSettings?.({ output_language: language.value });
      language.dataset.saved = language.value;
    } catch (error) {
      language.value = previous;
      message.textContent = error.message;
    } finally { language.disabled = busy; }
  };
  label.append(language);
  group.append(element("h3", "语言"), label, message);
  page.append(backButton, element("h2", "设置"), group);
  root.append(page);
  return page;
}
export function renderTaskPanel(root, snapshot, context) {
  const p = snapshot.project,
    runningTask = snapshot.tasks.find((t) => t.task_status === "running"),
    busy = Boolean(runningTask),
    { session_id, refresh, onError } = context,
    state =
      context.view ||
      (context.view = {
        page: "overview",
        episode_id: null,
        tab: "script",
        shot_id: null,
      }),
    act = async (command, project = false) => {
      try {
        const result = await sendCommand(
          session_id,
          {
            project_id: p.id,
            request_id: globalThis.crypto.randomUUID(),
            ...command,
          },
          project,
        );
        await refresh();
        return result;
      } catch (error) {
        onError(error.message);
        blockingDialog(root, error.message);
        throw error;
      }
    },
    button = (title, fn, freeze = busy) => {
      const b = element("button", title);
      if (freeze) {
        const name = runningTask.name || names[runningTask.business_type] || "任务";
        b.setAttribute("aria-disabled", "true");
        b.style.opacity = ".5";
        b.style.cursor = "not-allowed";
        b.title = `“${name}”正在运行`;
        b.onclick = () =>
          blockingDialog(
            root,
            `任务“${name}”正在运行。项目内同一时间只能执行一个任务，请等待它结束后再试。`,
          );
      } else b.onclick = () => Promise.resolve(fn()).catch(() => {});
      return b;
    };
  const nodeUi = ({ business, id, node, buttons, repair = null, readOnly = false, opinion = !readOnly }) => {
    const key = `${business}:${id}`;
    if (state.opinionPending?.[key]) {
      const tasks = snapshot.tasks.filter((task) => task.business_type === business && task.target_id === id);
      const latest = [...tasks].sort((a, b) => b.queue_order - a.queue_order)[0];
      if (latest?.task_status === "completed" && !tasks.some((task) => ["queued", "running"].includes(task.task_status))) {
        state.opinions ??= {};
        delete state.opinions[key];
        delete state.opinionPending[key];
      }
    }
    const ui = element("div", "", "node-ui");
    const actions = element("div", "", "workflow-generation-row");
    const latest = latestNodeTask(snapshot.tasks, business, id);
    const taskRow = taskStatusRow(latest);
    // 剧本节点的审核与修改都在同一节点上进行，进行中时标明当前步骤（如「第 1 轮修改剧本」），让修改流程可见。
    if (taskRow && business === "script-review" && ["queued", "running"].includes(latest.task_status)) {
      const current = (snapshot.steps || []).filter((step) => step.task_id === latest.id && ["running", "ready"].includes(step.step_status))
        .sort((a, b) => (a.step_status === "running" ? -1 : 0) - (b.step_status === "running" ? -1 : 0) || a.seq - b.seq)[0];
      const name = latest.action === "revise" ? "按审核意见修改剧本" : "审核剧本";
      taskRow.textContent += ` · ${name}${current ? ` · 当前：${current.name}` : ""}`;
    }
    const roundNote = revisionNote(latest, snapshot.steps, NODE_DEFINITIONS[business]?.retryRounds);
    if (taskRow && roundNote) taskRow.textContent += ` · ${roundNote}`;
    const buttonBox = element("div", "", "node-ui-buttons");
    for (const item of buttons) buttonBox.append(item);
    if (!readOnly && NODE_DEFINITIONS[business] && !NODE_DEFINITIONS[business].retired &&
        !['assembly', 'tail', 'first-last-frame', 'multimodal'].includes(business))
      buttonBox.append(button('查看规则', () => openRules(business, id), false));
    actions.append(buttonBox);
    if (taskRow) actions.append(taskRow);
    ui.append(actions);
    if (opinion) {
      state.opinions ??= {};
      const input = element("input", "", "node-ui-opinion");
      input.placeholder = "本次执行意见";
      input.setAttribute("aria-label", "本次执行意见");
      input.value = state.opinions[key] || "";
      input.oninput = () => { state.opinions[key] = input.value; };
      ui.append(input);
    }
    const failureRow = taskFailureRow(latest);
    if (failureRow) ui.append(failureRow);
    if (node.node_state.status === "rejected" && node.node_state.reason)
      ui.append(reasonParagraph(`未通过原因：${node.node_state.reason}`));
    if (repair) {
      const row = element("div", "", "node-ui-buttons node-ui-repair-row");
      row.append(repair);
      ui.append(row);
    }
    return ui;
  };
  const nodeCard = (business, id, node, { readOnly = false } = {}) => {
    const card = element("section", "", "session-project");
    card.dataset.business = business;
    card.append(element("h3", names[business] || business));
    if (node.address) {
      const asset = element(
        ["video", "assembly"].includes(business) ? "video" : "img",
      );
      asset.src = node.address + "?session_id=" + encodeURIComponent(session_id);
      asset.controls = true;
      asset.style.maxWidth = "100%";
      if (asset.tagName === "IMG") {
        asset.alt = names[business];
        asset.style.cursor = "zoom-in";
        asset.onclick = () => showImagePreview(root, asset);
      }
      card.append(asset);
    } else if (business === "script-review") {
      // 剧本节点的正文在剧本详情页展示，卡片只放公共节点 UI。
    } else if (business === "seconds") {
      const shot = p.episodes.flatMap(episode => episode.shot_list.shots).find(shot => shot.id === id);
      if (shot) {
        const setup = element('section', '', 'seconds-shot-setup');
        setup.append(element('h4', '整镜设定（来自镜头表）'), element('p', readable(shotSceneSetup(shot)), 'prompt full'), shotCastDetails(p, shot));
        card.append(setup);
      }
      card.append(element('h4', '节拍时间线'));
      card.append(secondsView(node));
    } else if (business === 'episode-scenes') {
      const episode = p.episodes.find(item => item.id === id);
      const scenes = sceneCatalog(p,episode);
      card.append(element('p', node.has_result && !scenes.length ? '本集没有需要固定的场景；一次性不重要地点保留在镜头正文。' : scenes.map(scene => scene.name).join('、') || '在大纲之后选择性提取重要、反复出现或指定的场景。','meta'));
    } else if (business === "outline") {
      const segments = element("div", "", "outline-segments");
      for (const part of [...(node.segments || [])].sort((a, b) => a.sequence - b.sequence))
        segments.append(
          element("p", `${part.sequence}. ${part.duration_seconds}秒 ${part.body}${part.causal ? `\n因果衔接：${part.causal}` : ""}`, "prompt full"),
        );
      card.append(segments);
    } else if (!["shots", "project-characters"].includes(business))
      card.append(
        element(
          "p",
          typeof node.body === "string"
            ? node.body
            : readable(payload(node, p)),
          "prompt full",
        ),
      );
    if (typeof node.body === "string" && business !== "script-review") appendJsonCopy(card, node.body);
    const program = ["first-last-frame", "multimodal", "assembly"].includes(business);
    const isPack = ["first-last-frame", "multimodal"].includes(business);
    const hasOutput = isPack ? Boolean(node.prompt.trim()) : business === "script-review" ? node.node_state.status !== "empty" : hasContent(node),
      typedOpinion = () => (state.opinions?.[`${business}:${id}`] || "").trim(),
      generate = (opinion = "", revise = false) => {
        const text = [opinion, typedOpinion()].filter(Boolean).join("\n");
        if (text) {
          state.opinionPending ??= {};
          state.opinionPending[`${business}:${id}`] = true;
        }
        if (business === "video" && text) return act({
          type: "submit", business_type: "video", target_id: id,
          action: hasOutput ? "regenerate" : "generate", opinion: text,
        });
        return act(business === "video" ? {
          type: "submit-group", group_type: "episode-film",
          action: hasOutput ? "regenerate" : "generate",
          episode_id: p.episodes.find(e => e.shot_list.shots.some(s => s.id === id)).id,
          shot_id: id,
        } : {
          type: "submit",
          business_type: business,
          target_id: id,
          action: revise && NODE_DEFINITIONS[business]?.handler === "text" ? "revise" : hasOutput ? "regenerate" : "generate",
          ...(text ? { opinion: text } : {}),
        });
      };
    const currentTask = snapshot.tasks.find((task) => task.business_type === business && task.target_id === id && ["queued", "running"].includes(task.task_status));
    const active = Boolean(currentTask);
    const latest = latestNodeTask(snapshot.tasks, business, id);
    const rejectedText = NODE_DEFINITIONS[business]?.handler === "text" &&
      (node.node_state.status === "rejected" || latest?.task_status === "rejected");
    const reviewReason = node.node_state.reason || (latest?.task_status === "rejected" ? latest.end_reason : "") || "";
    const rejectedVideo = business === "video" && node.node_state.status === "rejected";
    const quiet = ["project-summary", "episode-summary"].includes(business);
    // 剧本节点：审核、重新审核、人工放行；未通过时原因下方为「修改」（按审核意见修改剧本后再审核），不提供原结果修订和人工编辑。
    const reviewOnly = business === "script-review";
    const buttons = [];
    const repair = (rejectedText || rejectedVideo) && !program && !active && !readOnly && reviewReason.trim()
      ? button(repairButtonLabel(business), () => generate(reviewReason, hasOutput)) : null;
    if (!active && !readOnly) buttons.push(button(isPack ? (hasOutput ? '重新编排' : '执行编排') : reviewOnly ? (hasOutput ? "重新审核" : "AI审核") : hasOutput ? '重新生成' : business === "assembly" ? "生成合片" : "AI生成", () => generate(program && node.node_state.status === "rejected" ? reviewReason : "")));
    if (!program && !reviewOnly && !active && !readOnly && !rejectedText && !rejectedVideo && hasOutput && (NODE_DEFINITIONS[business]?.handler === "text" || node.node_state.status === "rejected"))
      buttons.push(
        button("原结果修订", () =>
          editor(
            root,
            "原结果修订",
            reviewReason,
            (opinion) => {
              if (!opinion.trim()) throw new Error("请输入修改意见");
              return generate(opinion.trim(), hasOutput);
            },
            { json: false, textField: 'opinion', submitLabel: '提交修订' },
          ),
        ),
      );
    const isMedia = [
      "character-image",
      "costume-image",
      "scene-image",
      "video",
      "tail",
      "assembly",
    ].includes(business);
    const upload = element("input");
    if (isMedia && !readOnly && !program) {
      upload.type = "file";
      upload.accept = ["video", "assembly"].includes(business)
        ? "video/mp4"
        : "image/png,image/jpeg,image/webp";
      upload.hidden = true;
      upload.disabled = busy;
      upload.setAttribute("aria-label", "导入节点媒体");
      upload.onchange = async () => {
        const file = upload.files?.[0];
        if (!file) return;
        try {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("文件读取失败"));
            reader.readAsDataURL(file);
          });
          await act({
            type: "manual-edit",
            business_type: business,
            target_id: id,
            content: { data },
          });
        } catch (error) {
          onError(error.message);
        }
      };
      card.append(upload);
    }
    if (!program && !reviewOnly && !active && !readOnly && !quiet) buttons.push(
      button("人工编辑", () =>
        isMedia
          ? upload.click()
          : editor(
              root,
              "人工编辑",
              ["project-summary", "episode-summary"].includes(business)
                ? node.body
                : business === "storyboard"
                  ? `integrated_multimodal_description:\n${node.integrated_multimodal_description}\noverall_soundscape:\n${node.overall_soundscape}\nnon_diegetic_music:\n${node.non_diegetic_music}`
                : business === 'episode-scenes'
                  ? { scenes: sceneCatalog(p,p.episodes.find(item => item.id === id)) }
                : business === "shots"
                  ? { shots: node.shots.map((shot) => Object.fromEntries(["title", "id", "scene_id", "scene_state", "scene_transition", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement", "on_screen_characters", "background_characters"].map((key) => [key, structuredClone(shot[key])]))) }
                : business === "project-characters"
                  ? { characters: node.characters.map((character) => ({
                      ...Object.fromEntries(Object.keys(blankCharacter()).filter((key) => key !== "costumes").map((key) => [key, character[key]])),
                      costumes: character.costumes.map(({ name, color, material, props }) => ({ name, color, material, props })),
                    })) }
                  : payload(node),
              (content) =>
                act({
                  type: "manual-edit",
                  business_type: business,
                  target_id: id,
                  content,
                }),
              {
                json: !["project-summary", "episode-summary", "storyboard"].includes(business),
                templates: { characters: blankCharacter() },
              },
            ),
      ),
    );
    if (!active && !readOnly && !quiet && node.node_state.status === "rejected" && (!program || hasOutput))
      buttons.push(
        button("人工放行", () =>
          act({ type: "override", business_type: business, target_id: id }),
        ),
      );
    buttons.push(
      button(
        "任务历史",
        () => {
          state.task_id = null;
          state.page = "history";
          state.history_business = business;
          state.target_id = id;
          context.paint();
        },
        false,
      ),
    );
    if (!program && currentTask && !readOnly)
      buttons.push(button("取消", () => act({ type: "cancel", task_id: currentTask.id }), false));
    const head = element("div", "", "section-head"),
      titles = element("div", "", "section-titles");
    titles.append(card.querySelector("h3"));
    titles.append(element("span", labels[node.node_state.status] || node.node_state.status, "node-data-tag"));
    head.append(titles);
    card.prepend(head);
    card.insertBefore(nodeUi({ business, id, node, buttons, repair, readOnly, opinion: !readOnly && !program }), head.nextSibling);
    return card;
  };
  root.replaceChildren();
  root.classList.add("session-view");
  const go = (page, values = {}) => {
    if (page !== "history" || state.page !== "history") {
      state.task_id = null;
      state.group_id = null;
      state.step_id = null;
      state.step_view = null;
    }
    state.page = page;
    Object.assign(state, values);
    context.paint();
  };
  const media = (url) =>
    url +
    (url.includes("?") ? "&" : "?") +
    "session_id=" +
    encodeURIComponent(session_id);
  const openRules = (business, id) => go('skill', {
    rule_business: business, rule_target: id, rule_return: state.page,
  });
  const env = {
    p,
    snapshot,
    state,
    button,
    act,
    nodeCard,
    nodeUi,
    go,
    media,
    payload,
    busy,
    labels,
    names,
    onError,
    openRules,
  };
  if (state.page === "overview") {
    const body = element("div", "", "session-body");
    renderOverview(body, env);
    root.append(body);
  } else if (state.page === "episode") renderEpisode(root, env, episodeTabs);
  else if (state.page === "character" || state.page === "characters")
    renderResource(root, env);
  else if (state.page === "history") renderHistory(root, env, snapshot);
  else if (state.page === 'skill') {
    const business = state.rule_business;
    const supplement = business === 'outline'
      ? p.episodes.find(e => e.id === state.rule_target)?.episode_requirements || ''
      : ['costume-image', 'video'].includes(business) ? '' : p.creative_direction || '';
    root.append(renderSkillDetail({
      label: names[business] || business,
      supplement,
      opinion: state.opinions?.[`${business}:${state.rule_target}`] || '',
    }, {
      load: () => request('rules?' + new URLSearchParams({ session_id, project_id: p.id, business })),
      back: () => go(state.rule_return || 'overview'),
    }));
  }
  else if (state.page === "script") {
    backHeader(root, "剧本详情", "返回项目概要", () => go("overview"));
    const card = element("section", "", "overview-card");
    card.append(
      element("p", `版本 ${p.script.version} · ${p.script.updated_at}`, "meta"),
      element("p", p.script.body, "prompt full"),
    );
    appendJsonCopy(card, p.script.body);
    root.append(card);
  } else if (state.page === "settings") {
    const page = renderSettings(root, {
      busy,
      settings: context.settings,
      saveSettings: context.saveSettings,
      back: () => go("overview"),
    });
    context.renderModels?.(page, busy);
  } else if (state.page === "library") context.renderLibrary?.(root);
  return root;
}
export { editor };
