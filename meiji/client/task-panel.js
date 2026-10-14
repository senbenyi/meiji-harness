import { NODE_DEFINITIONS } from '../shared/node-definitions.js';
import { bindingNumbers } from '../shared/shot-text-inputs.js';
import { editor, readable } from "./content-forms.js";
import { renderOverview, renderEpisode, backHeader } from "./project-ui.js";
import { renderResource, blankCharacter } from "./resource-ui.js";
import { renderHistory } from "./history-ui.js";
import { element, showPanelDialog, appendJsonCopy } from "./panel-dom.js";
import { sendCommand } from "./task-client.js";
const labels = {
  empty: "未生成",
  running: "生成中",
  generated: "已生成",
  rejected: "未通过",
  failed: "失败",
  cancelled: "已取消",
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
  "project-summary": "项目摘要",
  "project-characters": "角色库",
  "episode-summary": "展示摘要",
  outline: "故事大纲",
  "script-split": "拆分剧集",
  shots: "镜头表",
  "shot-characters": "镜头角色与服装",
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
  const nodeUi = ({ business, id, node, buttons, readOnly = false, opinion = !readOnly }) => {
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
    actions.append(element("p", labels[node.node_state.status] || node.node_state.status, "node-ui-status"));
    for (const item of buttons) actions.append(item);
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
    const notice = node.node_state.status === "rejected"
      ? node.node_state.reason
      : node.node_state.status === "failed"
        ? node.node_state.fail_message || ""
        : "";
    if (notice) ui.append(element("p", notice, "error"));
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
        asset.onclick = () => {
          const d = element("dialog", "", "still-preview"),
            image = element("img"),
            close = element("button", "×", "cancel");
          image.src = asset.src;
          image.alt = asset.alt;
          close.setAttribute("aria-label", "关闭图片预览");
          close.onclick = () => d.close();
          d.append(image, close);
          root.append(d);
          d.addEventListener("close", () => d.remove(), { once: true });
          showPanelDialog(d);
        };
      }
      card.append(asset);
    } else if (business === 'shot-characters') {
      card.append(element('p', !node.has_result ? '尚未识别' : !node.on_screen_characters.length
        ? (node.node_state.status === 'generated' ? '已确认无人出镜' : '候选：无人出镜')
        : readable(bindingNumbers(p, node)), 'prompt full'));
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
    if (typeof node.body === "string") appendJsonCopy(card, node.body);
    const program = ["first-last-frame", "multimodal", "assembly"].includes(business);
    const isPack = ["first-last-frame", "multimodal"].includes(business);
    const hasOutput = isPack ? Boolean(node.prompt.trim()) : hasContent(node),
      typedOpinion = () => (state.opinions?.[`${business}:${id}`] || "").trim(),
      generate = (opinion = "", revise = false) => {
        const text = [opinion, typedOpinion()].filter(Boolean).join("\n");
        if (text) {
          state.opinionPending ??= {};
          state.opinionPending[`${business}:${id}`] = true;
        }
        return act(business === "video" ? {
          type: "submit-group", group_type: "episode-film",
          action: hasOutput ? "regenerate" : "generate",
          episode_id: p.episodes.find(e => e.shot_list.shots.some(s => s.id === id)).id,
          shot_id: id, ...(text ? { opinion: text } : {}),
        } : {
          type: "submit",
          business_type: business,
          target_id: id,
          action: revise && NODE_DEFINITIONS[business]?.handler === "text" ? "revise" : hasOutput ? "regenerate" : "generate",
          ...(text ? { opinion: text } : {}),
        });
      };
    const currentTask = snapshot.tasks.find((task) => task.business_type === business && task.target_id === id && ["queued", "running"].includes(task.task_status));
    const active = node.node_state.status === "running" || Boolean(currentTask);
    const quiet = ["project-summary", "episode-summary"].includes(business);
    const buttons = [];
    if (!active && !readOnly) buttons.push(button(isPack ? (hasOutput ? '重新编排' : '执行编排') : hasOutput ? '重新生成' : business === "assembly" ? "生成合片" : "AI生成", () => generate()));
    if (!program && !active && !readOnly && hasOutput && (NODE_DEFINITIONS[business]?.handler === "text" || node.node_state.status === "rejected"))
      buttons.push(
        button("原结果修订", () =>
          editor(
            root,
            "原结果修订",
            node.node_state.reason,
            (opinion) => {
              if (!opinion.trim()) throw new Error("请输入修改意见");
              return generate(opinion.trim(), true);
            },
            { json: false },
          ),
        ),
      );
    const isMedia = [
      "character-image",
      "costume-image",
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
    if (!program && !active && !readOnly && !quiet) buttons.push(
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
                : business === "shot-characters"
                  ? bindingNumbers(p, node)
                : business === "shots"
                  ? { shots: node.shots.map((shot) => Object.fromEntries(["title", "number", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement"].map((key) => [key, structuredClone(shot[key])]))) }
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
    if (!program && !active && !readOnly && !quiet && node.node_state.status === "rejected")
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
    head.append(titles);
    card.prepend(head);
    card.insertBefore(nodeUi({ business, id, node, buttons, readOnly, opinion: !readOnly && !program }), head.nextSibling);
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
  };
  if (state.page === "overview") {
    const body = element("div", "", "session-body");
    renderOverview(body, env);
    root.append(body);
  } else if (state.page === "episode") renderEpisode(root, env, episodeTabs);
  else if (state.page === "character" || state.page === "characters")
    renderResource(root, env);
  else if (state.page === "history") renderHistory(root, env, snapshot);
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
