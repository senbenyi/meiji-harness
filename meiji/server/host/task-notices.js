// 会话通知只在会话界面显示一张提示卡（command/run + command/done），
// 不进入模型上下文、不唤醒 AI；面板已展示状态，会话只做提示。不依赖 jobs/goals。
const statusLabels = {
  completed: "已通过",
  rejected: "未通过",
  failed: "失败",
  cancelled: "已取消",
  superseded: "已取消",
  queued: "排队中",
  running: "生成中",
};
const eventLabels = {
  submitted: "已受理",
  "cancel-requested": "已请求取消",
  "manual-edit": "人工编辑已受理",
  override: "人工放行已受理",
  delete: "删除已受理",
  "start-queued": "排队项已开始",
  "remove-queued": "排队项已移除",
};

export function noticeText(notice) {
  const head =
    statusLabels[notice.status] || eventLabels[notice.event] || notice.event;
  const lines = [`制作任务：${head}`];
  if (notice.reason) lines.push(`原因：${notice.reason}`);
  if (notice.task_id) lines.push(`任务：${notice.task_id}`);
  if (notice.group_id) lines.push(`组合任务：${notice.group_id}`);
  return lines.join("\n");
}

export async function deliverTaskNotice(controller, notice) {
  if (!notice?.id || !notice.session_id || !notice.project_id)
    throw new Error("通知缺少稳定身份或接收会话");
  const resolved = await controller.resolveAgent(notice.session_id);
  const session = resolved?.agent?.session;
  if (typeof session?.append !== "function")
    throw new Error("接收会话不可用，通知保持待投递");
  const failed = ["rejected", "failed"].includes(notice.status);
  await session.append("command/run", {
    commandId: notice.id,
    name: "制作任务",
    args: "制作任务",
    source: { kind: "user" },
  });
  await session.append("command/done", {
    commandId: notice.id,
    kind: failed ? "error" : "success",
    text: `${noticeText(notice)}\n`,
  });
  return { delivered: true, id: notice.id };
}
