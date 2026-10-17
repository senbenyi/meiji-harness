import { groupStatus } from "../../shared/task-labels.js";
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
  return { group, tasks, ...groupStatus(tasks), steps: snapshot.steps.filter(s => tasks.some(t => t.id === s.task_id)).sort((a,b)=>tasks.findIndex(t=>t.id===a.task_id)-tasks.findIndex(t=>t.id===b.task_id) || a.seq-b.seq) };
}

// 节点只接收本组任务和步骤状态，不附带历史提示词。
export function groupView(snapshot, groupId) {
  const detail = groupDetail({ read: () => snapshot }, groupId);
  if (!detail) return null;
  return {
    ...detail,
    steps: detail.steps.map(step => {
      const { prompt, ...rest } = step;
      return { ...rest, has_prompt: prompt != null };
    }),
  };
}

export function activityGroups(before, next) {
  const ids = new Set();
  const previousTasks = new Map((before?.tasks || []).map(task => [task.id, task]));
  for (const task of next.tasks || []) {
    const old = previousTasks.get(task.id);
    if (!old || old.task_status !== task.task_status || old.end_reason !== task.end_reason || old.started_at !== task.started_at || old.queue_order !== task.queue_order)
      ids.add(task.group_id);
  }
  const previousSteps = new Map((before?.steps || []).map(step => [step.id, step]));
  for (const step of next.steps || []) {
    const old = previousSteps.get(step.id);
    if (!old || old.step_status !== step.step_status || old.round !== step.round || old.error_reason !== step.error_reason) {
      const task = next.tasks.find(item => item.id === step.task_id);
      if (task?.group_id) ids.add(task.group_id);
    }
  }
  return [...ids].filter(Boolean).map(id => groupView(next, id)).filter(Boolean);
}
