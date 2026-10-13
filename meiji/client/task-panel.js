import { editor, readable } from "./content-forms.js";
import { renderOverview, renderEpisode, backHeader } from "./project-ui.js";
import { renderResource, blankCharacter } from "./resource-ui.js";
import { renderHistory } from "./history-ui.js";
import { element, showPanelDialog, appendJsonCopy } from "./panel-dom.js";
import { sendCommand } from "./task-client.js";
const labels = {
  empty: "未生成",
  queued: "排队中",
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
  seconds: "每秒分镜",
  storyboard: "文本提示词",
  video: "视频",
  tail: "尾帧",
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
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasContent);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    !["id", "node_state", "script_version", "number", "sequence", "duration_seconds", "actual_duration_seconds", "costume_id"].includes(key) && hasContent(child));
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
  const nodeCard = (business, id, node, { readOnly = false } = {}) => {
    const card = element("section", "", "session-project");
    card.dataset.business = business;
    card.append(
      element("h3", names[business] || business),
      element("span", labels[node.node_state.status] || node.node_state.status, "status-label"),
    );
    if (node.node_state.reason) card.append(element("p", node.node_state.reason, "error"));
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
    } else if (business === "outline") {
      const segments = element("div", "", "outline-segments");
      for (const part of [...(node.segments || [])].sort((a, b) => a.sequence - b.sequence))
        segments.append(
          element("p", `${part.sequence}. ${part.duration_seconds}秒 ${part.body}${part.causal ? `\n因果衔接：${part.causal}` : ""}`, "prompt full"),
        );
      card.append(segments);
    } else if (business !== "shots")
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
    const hasOutput = hasContent(node),
      generate = (opinion = "") =>
        act(business === "video" ? {
          type: "submit-group", group_type: "episode-film",
          action: hasOutput ? "regenerate" : "generate",
          episode_id: p.episodes.find(e => e.shot_list.shots.some(s => s.id === id)).id,
          shot_id: id, ...(opinion ? { opinion } : {}),
        } : {
          type: "submit",
          business_type: business,
          target_id: id,
          action: hasOutput ? "regenerate" : "generate",
          ...(opinion ? { opinion } : {}),
        });
    const active = ["queued", "running"].includes(node.node_state.status);
    if (!active && !readOnly) card.append(button(hasOutput ? "重新生成" : business === "assembly" ? "生成合片" : "AI生成", () => generate()));
    if (!active && !readOnly && hasOutput && node.node_state.status === "rejected")
      card.append(
        button("按意见修改", () =>
          editor(
            root,
            "按意见修改",
            node.node_state.reason,
            (opinion) => {
              if (!opinion.trim()) throw new Error("请输入修改意见");
              return generate(opinion.trim());
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
    if (isMedia && !readOnly) {
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
    if (!readOnly) card.append(
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
    if (!readOnly && node.node_state.status === "rejected")
      card.append(
        button("人工放行", () =>
          act({ type: "override", business_type: business, target_id: id }),
        ),
      );
    card.append(
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
    const currentTask = snapshot.tasks.find((task) => task.business_type === business && task.target_id === id && ["queued", "running"].includes(task.task_status));
    if (currentTask && !readOnly) {
      card.append(button("取消", () => act({ type: "cancel", task_id: currentTask.id }), false));
      if (currentTask.task_status === "queued") card.append(
        button("开始", () => act({ type: "start-queued", task_id: currentTask.id }), false),
        button("移除", () => act({ type: "remove-queued", task_id: currentTask.id }), false),
      );
    }
    const head = element("div", "", "section-head"),
      titles = element("div", "", "section-titles"),
      actions = element("div", "", "workflow-generation-row");
    titles.append(
      card.querySelector("h3"),
      card.querySelector(".status-label"),
    );
    head.append(titles);
    card.prepend(head);
    for (const b of [...card.children].filter((n) => n.tagName === "BUTTON"))
      actions.append(b);
    card.insertBefore(actions, head.nextSibling);
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
    const page = element("section", "", "settings-page");
    page.append(
      button("← 返回项目", () => go("overview"), false),
      element("h2", "设置"),
      element("p", p.name, "meta"),
    );
    const group = element("section", "", "settings-group"),
      form = element("form"),
      language = element("select"),
      label = element("label", "模型返回语言");
    form.dataset.draftKey = "language";
    form.oninput = () => (form.dataset.dirty = "true");
    language.name = "output_language";
    language.setAttribute("aria-label", "模型返回语言");
    for (const [v, text] of [
      ["zh-CN", "简体中文"],
      ["en", "English（英文）"],
    ]) {
      const o = element("option", text);
      o.value = v;
      language.append(o);
    }
    language.value = p.output_language;
    language.disabled = busy;
    label.append(language);
    const save = element("button", "保存", "primary");
    save.type = "submit";
    save.disabled = busy;
    form.append(
      label,
      element(
        "p",
        "仅影响当前短剧后续生成的内容，已有内容保留原文。界面仍使用中文。",
        "meta",
      ),
      save,
    );
    form.onsubmit = (event) => {
      event.preventDefault();
      void act({ type: "edit", fields: { output_language: language.value } }, true)
        .then(() => {
          form.dataset.dirty = "false";
        })
        .catch(() => {});
    };
    group.append(element("h3", "内容生成"), form);
    page.append(group);
    const rulesGroup = element("section", "", "settings-group"),
      targets = new Map([[p.id, "项目"]]);
    for (const c of p.character_library.characters) {
      targets.set(c.id, c.number);
      for (const co of c.costumes) targets.set(co.id, co.number);
    }
    for (const e of p.episodes) {
      targets.set(e.id, `第${e.sequence}集`);
      for (const s of e.shot_list.shots)
        targets.set(s.id, `第${e.sequence}集/${s.number}`);
    }
    const rules = p.rules.map(({ id, node_id, ...row }) => ({
      ...row,
      node_number: node_id ? targets.get(node_id) : "",
    }));
    rulesGroup.append(
      element("h3", "规则"),
      button("编辑规则", () =>
        editor(root, "规则列表", { rules: rules }, ({ rules }) =>
          act({ type: "edit", fields: { rules } }, true),
        ),
      ),
    );
    page.append(rulesGroup);
    context.renderModels?.(page, busy);
    root.append(page);
  } else if (state.page === "library") context.renderLibrary?.(root);
  return root;
}
export { editor };
