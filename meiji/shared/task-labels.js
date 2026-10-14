import { BUSINESS_DEFINITIONS } from "./node-definitions.js";

// 名称在新记录创建时保存；旧历史只读补显，不改写原记录。
export const businessNames = Object.freeze({
  ...Object.fromEntries(
    Object.entries(BUSINESS_DEFINITIONS).map(([business, definition]) => [
      business,
      definition.label,
    ]),
  ),
  script: "已移除的剧本生成任务",
  "episode-characters": "已移除的历史任务",
});
export function taskName(task, project) {
  if (task.name) return task.name;
  const business = businessNames[task.business_type] || task.business_type;
  let target = "";
  for (const c of project.character_library.characters) {
    if (c.id === task.target_id) target = c.name;
    for (const co of c.costumes) if (co.id === task.target_id) target = `${c.name}·${co.name}`;
  }
  for (const e of project.episodes) {
    if (e.id === task.target_id) target = `第 ${e.sequence} 集`;
    for (const s of e.shot_list.shots)
      if (s.id === task.target_id) target = `第 ${e.sequence} 集 ${s.number}`;
  }
  if (['first-last-frame', 'multimodal'].includes(task.business_type)) return `${target} · 执行${business}`;
  const action = { generate: "生成", regenerate: "重新生成", continue: "生成", manual_edit: "编辑", override: "放行", delete: "删除" }[task.action] || "生成";
  if (task.business_type === "script-split") return `${task.action === "manual_edit" ? "编辑拆分设置" : "拆分剧集"}`;
  if (task.business_type === "project-characters") return `${task.action === "regenerate" ? "重新提取" : "提取"}剧本重要角色`;
  return `${target ? target + " · " : ""}${action}${business}`;
}
export function stepName(step, task) {
  if (step.name) return step.name;
  const business = businessNames[task.business_type] || task.business_type;
  return {
    precheck: "前置检查", generate: task.business_type === "project-characters" ? "提取角色资料" : `${['first-last-frame','multimodal'].includes(task.business_type) ? '执行' : task.action === 'regenerate' ? '重新生成' : '生成'}${business}`,
    review: `${step.round ? `第 ${step.round} 轮` : ""}${step.review_type === "program" ? "程序审核" : "AI审核"}${business}`,
    revise: `第 ${step.round} 轮修订${business}`, manual_edit: "保存人工编辑",
    override: "人工放行", impact: "检查删除影响", apply: task.business_type === 'video' ? '校验视频、测量时长与截取尾帧' : '执行删除',
  }[step.kind] || step.kind;
}
export function groupName(group, tasks, project) {
  if (group.name) return group.name;
  if (group.group_type === "single") return tasks[0] ? taskName(tasks[0], project) : "任务";
  if (group.group_type === "workflow") {
    if (tasks[0]?.business_type === "project-characters") return "提取剧本重要角色";
    return tasks[0] ? taskName(tasks[0], project) : "制作任务";
  }
  const e = project.episodes.find(e => e.id === group.episode_id);
  const scope = group.shot_ids?.length === 1 ? project.episodes.flatMap(e=>e.shot_list.shots).find(s=>s.id===group.shot_ids[0])?.number : "";
  return `${e ? `第 ${e.sequence} 集` : "剧集"}${scope ? ` ${scope}` : ""}${group.group_type === "episode-film" ? "成片" : "每秒分镜"}${group.action === "continue" ? " · 继续" : ""}`;
}
export function groupStatus(tasks) {
  const stopped = tasks.find(t=>["failed","rejected","cancelled"].includes(t.task_status));
  if (stopped) return { status: stopped.task_status, reason: stopped.end_reason || "" };
  if (tasks.some(t=>t.task_status === "running")) return { status: "running", reason: "" };
  if (tasks.some(t=>t.task_status === "queued")) return { status: "queued", reason: "" };
  if (tasks.length && tasks.every(t=>t.task_status === "completed")) return { status: "completed", reason: "" };
  const discarded = tasks.find(t=>t.task_status === "superseded");
  return { status: discarded ? "superseded" : "queued", reason: discarded?.end_reason || "" };
}
export function historyGroups(snapshot) {
  const rows = snapshot.groups.map(group => ({ group, tasks: snapshot.tasks.filter(t=>t.group_id === group.id).sort((a,b)=>a.group_seq-b.group_seq) }));
  return rows.map(row=>({...row,...groupStatus(row.tasks),name:groupName(row.group,row.tasks,snapshot.project)}))
    .sort((a,b)=>Math.max(0,...b.tasks.map(t=>t.queue_order))-Math.max(0,...a.tasks.map(t=>t.queue_order)));
}
