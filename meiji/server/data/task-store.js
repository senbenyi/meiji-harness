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
