import { historyGroups, taskName, stepName } from "../shared/task-labels.js";
import { NODE_TYPES } from "../shared/task_contract.js";
import { BUSINESS_DEFINITIONS } from "../shared/node-definitions.js";
import { element } from "./panel-dom.js";
const nodeTypeNames = {
  "script-review": "剧本",
  "project-summary": "项目摘要",
  "project-characters": "剧本重要角色",
  "character-image": "角色图片",
  "costume-image": "角色定妆照",
  "episode-summary": "展示摘要",
  "episode-scenes": "提取场景", "scene-image": "场景参考图",
  outline: "故事大纲",
  "episode-characters": "已移除的历史任务",
  shots: "镜头表",
  "shot-characters": "镜头角色与服装",
  seconds: "每秒分镜",
  storyboard: "文本提示词",
  video: "视频",
  tail: "尾帧", 'first-last-frame': '首尾帧参数编排', multimodal: '多模态参数编排',
  assembly: "合片",
};
const text = (value) =>
  typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
function isAiStep(step, task) {
  const definition = BUSINESS_DEFINITIONS[task.business_type];
  if (step.kind === "review") {
    const name = stepName(step, task);
    return !name.includes("程序审核") && (name.includes("AI审核") || Boolean(definition?.aiReview));
  }
  return ["generate", "revise"].includes(step.kind) &&
    (["text", "media"].includes(definition?.handler) || ["script", "episode-characters"].includes(task.business_type)) &&
    !["assembly", "tail"].includes(task.business_type);
}
// 记录卡片：标题与复制按钮同一行，正文完整展示不截断。
function copyButton(label, read, title = "复制") {
  const copy = element("button", title, "meiji-log-copy");
  copy.type = "button";
  copy.setAttribute("aria-label", label);
  copy.onclick = async (event) => {
    event.stopPropagation();
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(read());
      copy.textContent = "已复制";
    } catch {
      copy.textContent = "复制失败，重试";
    } finally {
      copy.disabled = false;
    }
  };
  return copy;
}
function identityRow(label, id) {
  const row = element("div", "", "meta run-id-row");
  row.dataset.recordId = id;
  const copy = copyButton(`复制${label} ID`, () => id);
  copy.classList.add("run-id-copy");
  row.append(element("span", `${label} ID：`), element("code", id), copy);
  return row;
}
function recordCard(title, value, { copy = true, copyTitle = "复制" } = {}) {
  const card = element("section", "", "run-record-card"),
    head = element("div", "", "run-record-head"),
    body = element("pre", text(value));
  head.append(element("h4", title));
  if (copy) head.append(copyButton(`复制${title}`, () => body.textContent, copyTitle));
  card.append(head, body);
  return card;
}
function tabRow(label, entries, selected, change) {
  const row = element("div", "", "tabs run-record-tabs");
  row.setAttribute("role", "tablist");
  row.setAttribute("aria-label", label);
  for (const [id, title] of entries) {
    const b = element("button", title);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(id === selected));
    b.onclick = () => change(id);
    row.append(b);
  }
  return row;
}
// 步骤的提示词或 HTTP 详情页。
function renderStepRecord(view, env, task, step) {
  const { state, go, button, names } = env,
    kind = state.step_view,
    header = element("div", "", "task-history-header");
  header.append(
    button(
      "← 返回任务",
      () => go("history", { step_id: null, step_view: null }),
      false,
    ),
    element(
      "h2",
      `${taskName(task, env.p)} · 第 ${step.seq} 步 ${stepName(step, task)} · ${kind === "http" ? "HTTP" : "提示词"}`,
    ),
  );
  const page = element("div", "", "run-record-page");
  view.append(header, page);
  const prompt =
    step.prompt && typeof step.prompt === "object" ? step.prompt : null;
  if (kind === "prompt") {
    if (step.prompt == null)
      return page.append(element("p", "此步骤没有提示词", "meta"));
    if (!prompt) return page.append(recordCard("提示词", step.prompt));
    const entries = prompt.messages
      ? prompt.messages.map((message, index) => [`${index + 1}. ${message.role}`, message.content])
      : ["system", "user"]
      .filter((key) => prompt[key] != null)
      .map((key) => [key, prompt[key]]);
    if (!entries.length && prompt.body != null)
      entries.push(["提示词", prompt.body]);
    if (!entries.length)
      return page.append(element("p", "此步骤没有提示词", "meta"));
    // 按实际请求顺序显示和复制全部消息。
    const bar = element("div", "", "run-record-head run-record-actions");
    bar.append(
      element("h3", "提示词"),
      copyButton("复制全部提示词", () =>
        entries.map(([key, value]) => `${key}:\n${text(value)}`).join("\n\n"),
      ),
    );
    page.append(bar);
    for (const [key, value] of entries)
      page.append(recordCard(key, value, { copy: false }));
    return;
  }
  const transfers = prompt?.transfers || [];
  if (!transfers.length)
    return page.append(element("p", "此步骤没有已保存的 HTTP 记录", "meta"));
  const index = Math.min(state.http_index || 0, transfers.length - 1),
    transfer = transfers[index],
    tab = state.http_tab === "response" ? "response" : "request";
  if (transfers.length > 1)
    page.append(
      tabRow(
        "选择请求次数",
        transfers.map((t, i) => [
          i,
          `第 ${i + 1} 次 · ${t.method || ""} ${t.path || ""}`.trim(),
        ]),
        index,
        (i) => go("history", { http_index: i }),
      ),
    );
  page.append(
    tabRow(
      "请求与返回",
      [
        ["request", "请求"],
        ["response", "返回"],
      ],
      tab,
      (id) => go("history", { http_tab: id }),
    ),
  );
  const { request, ...response } = transfer;
  const responded = ["ok", "status", "body", "error", "bytes"].some((key) => Object.hasOwn(transfer, key));
  page.append(
    tab === "request"
      ? recordCard("请求", request)
      : responded
        ? recordCard("返回", response)
        : element("p", "尚未返回", "meta"),
  );
}
const statuses = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  rejected: "未通过",
  failed: "失败",
  cancelled: "已取消",
};
export function renderHistory(root, env, snapshot) {
  const { p, state, button, go, names } = env,
    groups = historyGroups(snapshot),
    selectedGroup = groups.find(row => state.task_id ? row.tasks.some(t=>t.id === state.task_id) : row.group.id === state.group_id),
    selected = selectedGroup?.tasks.find(t=>t.id === state.task_id) || selectedGroup?.tasks[0],
    view = element(
      "section",
      "",
      `task-history-page ${selected ? "run-detail-page" : "run-list-page"}`,
    ),
    header = element("div", "", "task-history-header");
  header.append(
    button(
      "← 返回",
      () => (selected ? go("history", { task_id: null, group_id: null, step_id: null, step_view: null }) : go("overview")),
      false,
    ),
    element(
      "h2",
      selected
        ? "任务组详情"
        : `${p.name} · 任务历史`,
    ),
  );
  view.append(header);
  root.append(view);
  const recordStep =
    selected && state.step_view
      ? snapshot.steps.find(
          (st) => st.id === state.step_id && selectedGroup.tasks.some(t=>t.id === st.task_id),
        )
      : null;
  if (recordStep) {
    header.remove();
    return renderStepRecord(view, env, selectedGroup.tasks.find(t=>t.id === recordStep.task_id), recordStep);
  }
  if (selected) {
    const groupHead = element("div", "", "run-group-head run-list-heading");
    groupHead.append(element("strong", selectedGroup.name), element("span", statuses[selectedGroup.status], `task-history-status is-${selectedGroup.status}`));
    view.append(groupHead, identityRow("任务组", selectedGroup.group.id), element("p", `任务完成 ${selectedGroup.tasks.filter(t=>t.task_status === "completed").length}/${selectedGroup.tasks.length}`, "meta"));
    for (const selected of selectedGroup.tasks) {
    const taskHead = element("div", "", "run-task-head run-list-heading");
    taskHead.dataset.taskId = selected.id;
    taskHead.append(element("h3", `${selected.group_seq}. ${taskName(selected, p)}`),element("span", statuses[selected.task_status], `task-history-status is-${selected.task_status}`));
    view.append(taskHead, identityRow("任务", selected.id));
    view.append(
      element(
        "p",
        `${selected.source === "session" ? "会话发起" : "面板发起"} · ${selected.created_at || ""}`,
        "meta",
      ),
    );
    if (selected.end_reason) {
      const reason = element("div", "", "run-step-error");
      reason.append(element("p", selected.end_reason, "error"),
        copyButton("复制原因", () => selected.end_reason, "复制原因"));
      view.append(reason);
    }
    const list = element("ol", "", "run-step-list");
    for (const step of snapshot.steps
      .filter((s) => s.task_id === selected.id)
      .sort((a, b) => a.seq - b.seq)) {
      const item = element("li", "", "run-step-card"),
        summary = element("div", "", "run-step-summary");
      item.dataset.stepId = step.id;
      item.dataset.stepNumber = step.seq;
      const passed = step.result?.是否通过 ?? step.result?.通过;
      const rejected = step.step_status === "rejected" || (step.kind === "review" && passed === false);
      const failed = step.step_status === "failed" || rejected;
      item.classList.toggle("is-failed", failed);
      const expanded = state.history_step_open ||= {};
      item.classList.toggle("is-expanded", expanded[step.id] ?? false);
      const heading = element("div", "", "run-step-heading");
      const toggle = button(item.classList.contains("is-expanded") ? "收起" : "展开", () => {}, false);
      toggle.onclick = (event) => {
        event.preventDefault();
        const open = item.classList.toggle("is-expanded");
        expanded[step.id] = open;
        toggle.textContent = open ? "收起" : "展开";
        toggle.setAttribute("aria-expanded", String(open));
      };
      toggle.className = "run-step-toggle";
      toggle.setAttribute("aria-expanded", String(item.classList.contains("is-expanded")));
      heading.append(
        element("strong", `${step.seq}. ${stepName(step, selected)}`),
        element(
          "span",
          rejected ? "未通过" : ({ready:"待执行",running:"执行中",done:"已完成",failed:"失败",skipped:"已跳过",cancelled:"已取消",superseded:"已取消"}[step.step_status] || step.step_status),
          `task-history-status is-${step.step_status}`,
        ),
      );
      heading.append(toggle);
      summary.append(heading, identityRow("步骤", step.id));
      item.append(summary);
      const detail = element("div", "", "run-step-detail");
      const reason = step.error_reason || (rejected ? step.result?.原因 : '');
      if (reason) {
        const error = element("div", "", "run-step-error");
        error.append(element("p", `${rejected ? '未通过原因' : failed ? '失败原因' : '原因'}：${reason}`, "error"),
          copyButton("复制原因", () => reason, "复制原因"));
        detail.append(error);
      }
      detail.append(element("p", `${step.started_at || "未开始"} → ${step.ended_at || "未结束"}`, "meta"));
      const result = recordCard("步骤结果", step.result, { copyTitle: "复制结果" });
      result.classList.add("run-step-result");
      detail.append(result);
      const links = element("div", "", "workflow-generation-row run-record-links");
      for (const [view, title] of [["prompt", "查看提示词"], ["http", "查看 HTTP"]]) {
        if (view === "prompt" && !isAiStep(step, selected)) continue;
        const link = button(title, () =>
          go("history", { task_id: selected.id, group_id:selectedGroup.group.id, step_id: step.id, step_view: view, http_index: 0, http_tab: "request" }),
        false);
        link.classList.add("run-record-link");
        links.append(link);
      }
      detail.append(links);
      item.append(detail);
      list.append(item);
    }
    view.append(list);
    }
    return;
  }
  const filters = element("div", "", "run-filters"),
    status = element("select"),
    target = element("select"),
    episode = element("select");
  const options = (select, label, values, value, key) => {
    select.setAttribute("aria-label", label);
    for (const [v, text] of values) {
      const o = element("option", text);
      o.value = v;
      select.append(o);
    }
    select.value = value || "";
    select.onchange = () =>
      go("history", { [key]: select.value, task_id: null, group_id:null, step_id:null, step_view:null });
  };
  options(
    status,
    "按任务状态筛选",
    [["", "全部状态"], ...Object.entries(statuses)],
    state.history_status,
    "history_status",
  );
  options(
    target,
    "按节点类型筛选",
    [
      ["", "全部对象"],
      ...NODE_TYPES.map((type) => [type, nodeTypeNames[type]]),
    ],
    state.history_business,
    "history_business",
  );
  options(
    episode,
    "按选集筛选",
    [["", "全部剧集"], ...p.episodes.map((e) => [e.id, `第 ${e.sequence} 集`])],
    state.history_episode,
    "history_episode",
  );
  filters.append(status, target, episode);
  view.append(filters);
  const filtered = groups.filter(row =>
    (!state.history_status || row.status === state.history_status) &&
    (!state.history_business || row.tasks.some(t=>t.business_type === state.history_business)) &&
    (!state.history_episode || row.tasks.some(t=>t.episode_id === state.history_episode)));
  view.append(element("p", `${filtered.length} 个任务组`, "meta"));
  const list = element("div", "", "task-history-list");
  view.append(list);
  for (const entry of filtered) {
    const t = entry.tasks[0];
    if (!t) continue;
    const openGroup = () => go("history", {group_id:entry.group.id,task_id:t.id,step_id:null,step_view:null});
    const row = element("article", "", "task-history-item run-list-row"),
      heading = element("div", "", "run-list-heading");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `查看${entry.name}组内任务步骤详情`);
    row.onclick = event => {if (!event.target.closest("button")) openGroup();};
    row.onkeydown = event => {if (event.target === row && ["Enter"," "].includes(event.key)) {event.preventDefault();openGroup();}};
    heading.append(button(entry.name,openGroup,false),element("span",statuses[entry.status],`task-history-status is-${entry.status}`));
    const current = entry.tasks.find(t=>t.task_status === "running") || entry.tasks.find(t=>t.task_status === "queued");
    const progress = element("progress");
    progress.max = entry.tasks.length;
    progress.value = entry.tasks.filter(t=>t.task_status === "completed").length;
    progress.setAttribute("aria-label","组内任务进度");
    row.append(heading,identityRow("任务组", entry.group.id),element("p",`${entry.group.source === "session" ? "会话发起" : "面板发起"} · ${entry.group.created_at || ""}`,"meta"),
      element("p",`任务完成 ${progress.value}/${progress.max}${current ? ` · 当前：${taskName(current,p)}` : ""}`,"meta"),element("p",entry.reason || "", "error"),progress);
    list.append(row);
  }
}
