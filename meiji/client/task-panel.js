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
  "costume-image": "服装图片",
};
function payload(node, project) {
  const numbers = new Map();
  for (const c of project.角色库.角色) {
    numbers.set(c.id, c.编号);
    for (const co of c.服装) numbers.set(co.id, co.编号);
  }
  const ref = {
    角色id: "角色编号",
    服装id: "服装编号",
    说话人id: "说话人编号",
    默认服装id: "默认服装编号",
  };
  const walk = (v) =>
    Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).flatMap(([k, x]) => {
              if (
                [
                  "id",
                  "状态",
                  "原因",
                  "剧本版本",
                  "说话人名称",
                  "图片",
                  "参考图",
                ].includes(k)
              )
                return [];
              if (ref[k])
                return [
                  [
                    ref[k],
                    numbers.get(x) ||
                      (k === "说话人id" ? v.说话人名称 || "" : ""),
                  ],
                ];
              return [[k, walk(x)]];
            }),
          )
        : v;
  return walk(node);
}
function hasContent(value) {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasContent);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      !["id", "状态", "原因", "剧本版本", "编号", "序号", "时长秒", "实际时长秒"].includes(key) &&
      !key.endsWith("id") &&
      hasContent(child),
  );
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
  const nodeCard = (business, id, node) => {
    const card = element("section", "", "session-project");
    card.dataset.business = business;
    card.append(
      element("h3", names[business] || business),
      element("span", labels[node.状态] || node.状态, "status-label"),
    );
    if (node.原因) card.append(element("p", node.原因, "error"));
    if (node.地址) {
      const asset = element(
        ["video", "assembly"].includes(business) ? "video" : "img",
      );
      asset.src = node.地址 + "?session_id=" + encodeURIComponent(session_id);
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
      for (const part of [...(node.小段 || [])].sort((a, b) => a.序号 - b.序号))
        segments.append(
          element("p", `${part.序号}. ${part.时长秒}秒 ${part.正文}`, "prompt full"),
        );
      card.append(segments);
    } else
      card.append(
        element(
          "p",
          typeof node.正文 === "string"
            ? node.正文
            : readable(payload(node, p)),
          "prompt full",
        ),
      );
    if (typeof node.正文 === "string") appendJsonCopy(card, node.正文);
    const hasOutput = hasContent(node),
      generate = (opinion = "") =>
        act(business === "video" ? {
          type: "submit-group", group_type: "episode-film",
          episode_id: p.剧集.find(e => e.镜头表.镜头.some(s => s.id === id)).id,
          shot_id: id, ...(opinion ? { opinion } : {}),
        } : {
          type: "submit",
          business_type: business,
          target_id: id,
          action: hasOutput ? "regenerate" : "generate",
          ...(opinion ? { opinion } : {}),
        });
    card.append(
      button(hasOutput ? "重新生成" : "AI生成", () => generate()),
    );
    if (hasOutput && node.状态 === "rejected")
      card.append(
        button("按意见修改", () =>
          editor(
            root,
            "按意见修改",
            "",
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
    if (isMedia) {
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
    card.append(
      button("人工编辑", () =>
        isMedia
          ? upload.click()
          : editor(
              root,
              "人工编辑",
              business === "shots"
                ? {
                    镜头: payload(node, p).镜头.map((s) =>
                      Object.fromEntries(
                        [
                          "序号",
                          "编号",
                          "时长秒",
                          "标题",
                          "正文",
                          "出镜角色",
                        ].map((key) => [key, s[key]]),
                      ),
                    ),
                  }
                : payload(node, p),
              (content) =>
                act({
                  type: "manual-edit",
                  business_type: business,
                  target_id: id,
                  content,
                }),
              {
                templates: {
                  角色:
                    business === "project-characters"
                      ? blankCharacter()
                      : { 角色编号: "", 出镜: "出镜" },
                },
              },
            ),
      ),
    );
    if (node.状态 === "rejected")
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
          state.target_id = null;
          context.paint();
        },
        false,
      ),
    );
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
      element("p", `版本 ${p.剧本.版本} · ${p.剧本.更新时间}`, "meta"),
      element("p", p.剧本.正文, "prompt full"),
    );
    appendJsonCopy(card, p.剧本.正文);
    root.append(card);
  } else if (state.page === "settings") {
    const page = element("section", "", "settings-page");
    page.append(
      button("← 返回项目", () => go("overview"), false),
      element("h2", "设置"),
      element("p", p.名称, "meta"),
    );
    const group = element("section", "", "settings-group"),
      form = element("form"),
      language = element("select"),
      label = element("label", "模型返回语言");
    form.dataset.draftKey = "language";
    form.oninput = () => (form.dataset.dirty = "true");
    language.name = "输出语言";
    language.setAttribute("aria-label", "模型返回语言");
    for (const [v, text] of [
      ["zh-CN", "简体中文"],
      ["en", "English（英文）"],
    ]) {
      const o = element("option", text);
      o.value = v;
      language.append(o);
    }
    language.value = p.输出语言;
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
      void act({ type: "edit", fields: { 输出语言: language.value } }, true)
        .then(() => {
          form.dataset.dirty = "false";
        })
        .catch(() => {});
    };
    group.append(element("h3", "内容生成"), form);
    page.append(group);
    const rulesGroup = element("section", "", "settings-group"),
      targets = new Map([[p.id, "项目"]]);
    for (const c of p.角色库.角色) {
      targets.set(c.id, c.编号);
      for (const co of c.服装) targets.set(co.id, co.编号);
    }
    for (const e of p.剧集) {
      targets.set(e.id, `第${e.序号}集`);
      for (const s of e.镜头表.镜头)
        targets.set(s.id, `第${e.序号}集/${s.编号}`);
    }
    const rules = p.规则.map(({ id, 节点id, ...row }) => ({
      ...row,
      节点编号: 节点id ? targets.get(节点id) : "",
    }));
    rulesGroup.append(
      element("h3", "规则"),
      button("编辑规则", () =>
        editor(root, "规则列表", { 规则: rules }, ({ 规则 }) =>
          act({ type: "edit", fields: { 规则 } }, true),
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
