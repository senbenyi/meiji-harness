// 只读视图；唯一写入入口是 ProjectModel.update 的一致提交。
export function taskDetail(model, id) {
  const snapshot = model.read(),
    task = snapshot.tasks.find((t) => t.id === id);
  if (!task) return null;
  return {
    task,
    steps: snapshot.steps
      .filter((s) => s.task_id === id)
      .sort((a, b) => a.seq - b.seq),
  };
}
export function groupDetail(model, id) {
  const snapshot = model.read(),
    group = snapshot.groups.find((g) => g.id === id);
  if (!group) return null;
  const tasks = snapshot.tasks
    .filter((t) => t.group_id === id)
    .sort((a, b) => a.group_seq - b.group_seq);
  const stopped = tasks.find((t) =>
    ["rejected", "failed", "cancelled"].includes(t.task_status),
  );
  let status = "queued",
    reason = "";
  if (stopped) {
    status = stopped.task_status;
    reason = stopped.end_reason;
  } else if (tasks.every((t) => t.task_status === "completed"))
    status = "completed";
  else if (
    tasks.some(
      (t) => t.task_status === "running" || t.task_status === "completed",
    )
  )
    status = "running";
  else if (tasks.some((t) => t.task_status === "superseded")) {
    status = "superseded";
    reason = tasks.find((t) => t.task_status === "superseded").end_reason;
  }
  return { group, tasks, status, reason };
}
