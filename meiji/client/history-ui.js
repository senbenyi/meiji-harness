import { element } from "./panel-dom.js";
const text = (value) =>
  typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
// 记录卡片：标题与复制按钮同一行，正文完整展示不截断。
function recordCard(title, value) {
  const card = element("section", "", "run-record-card"),
    head = element("div", "", "run-record-head"),
    copy = element("button", "复制", "meiji-log-copy"),
    body = element("pre", text(value));
  copy.type = "button";
  copy.setAttribute("aria-label", `复制${title}`);
  copy.onclick = async (event) => {
    event.stopPropagation();
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(body.textContent);
      copy.textContent = "已复制";
    } catch {
      copy.textContent = "复制失败，重试";
    } finally {
      copy.disabled = false;
    }
  };
  head.append(element("h4", title), copy);
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
      `${names[task.business_type] || task.business_type} · 第 ${step.seq} 步 ${step.kind} · ${kind === "http" ? "HTTP" : "提示词"}`,
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
    const entries = ["system", "user"]
      .filter((key) => prompt[key] != null)
      .map((key) => [key, prompt[key]]);
    if (!entries.length && prompt.body != null)
      entries.push(["提示词", prompt.body]);
    if (!entries.length)
      return page.append(element("p", "此步骤没有提示词", "meta"));
    for (const [key, value] of entries)
      page.append(recordCard(key, value));
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
  page.append(
    tab === "request"
      ? recordCard("请求", request)
      : recordCard("返回", response),
  );
}
const statuses = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  rejected: "未通过",
  failed: "失败",
  cancelled: "已取消",
  superseded: "已作废",
};
export function renderHistory(root, env, snapshot) {
  const { p, state, button, go, act, names } = env,
    selected = snapshot.tasks.find((t) => t.id === state.task_id),
    view = element(
      "section",
      "",
      `task-history-page ${selected ? "run-detail-page" : "run-list-page"}`,
    ),
    header = element("div", "", "task-history-header");
  header.append(
    button(
      "← 返回",
      () => (selected ? go("history", { task_id: null }) : go("overview")),
      false,
    ),
    element(
      "h2",
      selected
        ? names[selected.business_type] || selected.business_type
        : `${p.名称} · 任务历史`,
    ),
  );
  view.append(header);
  root.append(view);
  const controls = (row, t) => {
    if (["running", "queued"].includes(t.task_status))
      row.append(
        button("取消", () => act({ type: "cancel", task_id: t.id }), false),
      );
    if (t.task_status === "queued")
      row.append(
        button("开始", () => act({ type: "start-queued", task_id: t.id })),
        button(
          "移除",
          () => act({ type: "remove-queued", task_id: t.id }),
          false,
        ),
      );
  };
  const recordStep =
    selected && state.step_view
      ? snapshot.steps.find(
          (st) => st.id === state.step_id && st.task_id === selected.id,
        )
      : null;
  if (recordStep) {
    header.remove();
    return renderStepRecord(view, env, selected, recordStep);
  }
  if (selected) {
    view.append(
      element(
        "p",
        `${statuses[selected.task_status] || selected.task_status} · ${selected.source === "session" ? "会话发起" : "面板发起"} · ${selected.created_at || ""}`,
        "meta",
      ),
      element("p", selected.end_reason || "", "error"),
    );
    controls(view, selected);
    const list = element("ol", "", "run-step-list");
    for (const step of snapshot.steps
      .filter((s) => s.task_id === selected.id)
      .sort((a, b) => a.seq - b.seq)) {
      const item = element("details", "", "run-step-card"),
        summary = element("summary", "", "run-step-summary");
      item.dataset.stepId = step.id;
      item.dataset.stepNumber = step.seq;
      const rejected = step.kind === "review" && step.result?.通过 === false;
      const failed = step.step_status === "failed" || rejected;
      item.classList.toggle("is-failed", failed);
      const expanded = state.history_step_open ||= {};
      item.open = expanded[step.id] ?? failed;
      const heading = element("div", "", "run-step-heading");
      const toggle = button(item.open ? "收起" : "展示", () => {}, false);
      toggle.onclick = (event) => {
        event.preventDefault();
        item.open = !item.open;
        expanded[step.id] = item.open;
        toggle.textContent = item.open ? "收起" : "展示";
        toggle.setAttribute("aria-expanded", String(item.open));
      };
      toggle.className = "run-step-toggle";
      toggle.setAttribute("aria-expanded", String(item.open));
      item.ontoggle = () => {
        expanded[step.id] = item.open;
        toggle.textContent = item.open ? "收起" : "展示";
        toggle.setAttribute("aria-expanded", String(item.open));
      };
      heading.append(
        element("strong", `${step.seq}. ${step.kind}`),
        element(
          "span",
          rejected ? "未通过" : step.step_status === "superseded" ? "已作废" : step.step_status,
          `task-history-status is-${step.step_status}`,
        ),
      );
      heading.append(toggle);
      summary.append(heading);
      item.append(summary);
      const detail = element("div", "", "run-step-detail");
      if (step.error_reason) detail.append(element("p", step.error_reason, "error"));
      detail.append(element("p", `${step.started_at || "未开始"} → ${step.ended_at || "未结束"}`, "meta"));
      detail.append(recordCard("步骤结果", step.result));
      const links = element("div", "", "workflow-generation-row run-record-links");
      for (const [view, title] of [["prompt", "查看提示词"], ["http", "查看 HTTP"]]) {
        const link = button(title, () =>
          go("history", { step_id: step.id, step_view: view, http_index: 0, http_tab: "request" }),
        false);
        link.classList.add("run-record-link");
        links.append(link);
      }
      detail.append(links);
      item.append(detail);
      list.append(item);
    }
    view.append(list);
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
      go("history", { [key]: select.value, task_id: null });
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
    "按对象筛选",
    [
      ["", "全部对象"],
      [p.id, "项目"],
      ...p.角色库.角色.flatMap((c) => [
        [c.id, `${c.编号} ${c.名称}`],
        ...c.服装.map((co) => [co.id, `${co.编号} ${co.名称}`]),
      ]),
      ...p.剧集.flatMap((e) => [
        [e.id, `第 ${e.序号} 集`],
        ...e.镜头表.镜头.map((s) => [s.id, `第 ${e.序号} 集 ${s.编号}`]),
      ]),
    ],
    state.target_id,
    "target_id",
  );
  options(
    episode,
    "按选集筛选",
    [["", "全部剧集"], ...p.剧集.map((e) => [e.id, `第 ${e.序号} 集`])],
    state.history_episode,
    "history_episode",
  );
  filters.append(status, target, episode);
  view.append(filters);
  for (const group of snapshot.groups) {
    if (
      snapshot.groups.some((g) => g.continued_from_group_id === group.id) ||
      (state.history_episode && group.episode_id !== state.history_episode) ||
      (state.target_id && state.target_id !== group.episode_id &&
        !group.shot_ids.includes(state.target_id))
    ) continue;
    const tasks = snapshot.tasks.filter((t) => t.group_id === group.id),
      stopped = tasks.find((t) =>
        ["failed", "rejected", "cancelled"].includes(t.task_status),
      );
    if (stopped) {
      const row = element("div", "", "notice workflow-generation-row");
      row.append(
        element(
          "span",
          `${group.group_type === "episode-film" ? "本集成片" : "本集每秒分镜"}：${stopped.end_reason || statuses[stopped.task_status]}`,
        ),
        button("继续", () =>
          act({ type: "continue-group", group_id: group.id }),
        ),
      );
      view.append(row);
    }
  }
  const tasks = snapshot.tasks
    .filter(
      (t) =>
        (!state.target_id || t.target_id === state.target_id) &&
        (!state.history_status || t.task_status === state.history_status) &&
        (!state.history_episode || t.episode_id === state.history_episode),
    )
    .sort((a, b) => b.queue_order - a.queue_order);
  view.append(element("p", `${tasks.length} 条任务`, "meta"));
  const list = element("div", "", "task-history-list");
  view.append(list);
  for (const t of tasks) {
    const row = element("article", "", "task-history-item run-list-row"),
      h = element("div", "", "run-list-heading"),
      open = button(
        names[t.business_type] || t.business_type,
        () => go("history", { task_id: t.id, step_id: null, step_view: null }),
        false,
      );
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `查看${names[t.business_type] || t.business_type}任务步骤详情`);
    row.onclick = (event) => {
      if (!event.target.closest("button"))
        go("history", { task_id: t.id, step_id: null, step_view: null });
    };
    row.onkeydown = (event) => {
      if (event.target === row && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        go("history", { task_id: t.id, step_id: null, step_view: null });
      }
    };
    h.append(
      open,
      element(
        "span",
        statuses[t.task_status] || t.task_status,
        `task-history-status is-${t.task_status}`,
      ),
    );
    const steps = snapshot.steps.filter((s) => s.task_id === t.id),
      progress = element("progress");
    progress.max = steps.length || 1;
    progress.value = steps.filter((s) => s.step_status === "done").length;
    progress.setAttribute("aria-label", "任务步骤进度");
    row.append(
      h,
      element(
        "p",
        `${t.source === "session" ? "会话发起" : "面板发起"} · ${t.created_at || ""}`,
        "meta",
      ),
      element("p", t.end_reason || ""),
      progress,
    );
    controls(row, t);
    list.append(row);
  }
}
