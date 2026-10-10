// 名称在新记录创建时保存；旧历史只读补显，不改写原记录。
export const businessNames = {
  "project-summary": "项目摘要", "project-characters": "剧本重要角色",
  script: "剧本", "script-split": "拆分剧集", "episode-summary": "展示摘要",
  outline: "剧情", "episode-characters": "本集资产", shots: "镜头表",
  seconds: "每秒分镜", storyboard: "分镜提示词", video: "视频",
  tail: "尾帧与实际时长", assembly: "合片", "character-image": "角色图",
  "costume-image": "服装图", "character-delete": "角色", "costume-delete": "服装",
};
export function taskName(task, project) {
  if (task.name) return task.name;
  const business = businessNames[task.business_type] || task.business_type;
  let target = "";
  for (const c of project.角色库.角色) {
    if (c.id === task.target_id) target = c.名称;
    for (const co of c.服装) if (co.id === task.target_id) target = `${c.名称}·${co.名称}`;
  }
  for (const e of project.剧集) {
    if (e.id === task.target_id) target = `第 ${e.序号} 集`;
    for (const s of e.镜头表.镜头)
      if (s.id === task.target_id) target = `第 ${e.序号} 集 ${s.编号}`;
  }
  const action = { generate: "生成", regenerate: "重新生成", continue: "生成", manual_edit: "编辑", override: "放行", delete: "删除" }[task.action] || "生成";
  if (task.business_type === "script-split") return `${task.action === "manual_edit" ? "编辑拆分设置" : "拆分剧集"}`;
  if (task.business_type === "project-characters") return `${task.action === "regenerate" ? "重新提取" : "提取"}剧本重要角色`;
  return `${target ? target + " · " : ""}${action}${business}`;
}
export function stepName(step, task) {
  if (step.name) return step.name;
  const business = businessNames[task.business_type] || task.business_type;
  return {
    precheck: "前置检查", generate: task.business_type === "project-characters" ? "提取角色资料" : `${task.action === "regenerate" ? "重新生成" : "生成"}${business}`,
    review: `${step.round ? `第 ${step.round} 轮` : ""}审核${business}`,
    revise: `第 ${step.round} 轮修订${business}`, manual_edit: "保存人工编辑",
    override: "人工放行", impact: "检查删除影响", apply: "执行删除",
  }[step.kind] || step.kind;
}
export function groupName(group, tasks, project) {
  if (group.name) return group.name;
  if (group.group_type === "single") return tasks[0] ? taskName(tasks[0], project) : "任务";
  if (group.group_type === "workflow") {
    if (tasks[0]?.business_type === "project-characters") return "提取剧本重要角色及图片";
    if (tasks[0]?.business_type === "episode-characters") return `${taskName(tasks[0],project)}及图片`;
    return tasks[0] ? taskName(tasks[0], project) : "制作任务";
  }
  const e = project.剧集.find(e => e.id === group.episode_id);
  const scope = group.shot_ids?.length === 1 ? project.剧集.flatMap(e=>e.镜头表.镜头).find(s=>s.id===group.shot_ids[0])?.编号 : "";
  return `${e ? `第 ${e.序号} 集` : "剧集"}${scope ? ` ${scope}` : ""}${group.group_type === "episode-film" ? "成片" : "每秒分镜"}${group.action === "continue" ? " · 继续" : ""}`;
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
  for (const t of snapshot.tasks.filter(t=>!t.group_id)) rows.push({group:{id:`single:${t.id}`,group_type:"single",created_at:t.created_at,source:t.source,virtual:true},tasks:[t]});
  return rows.map(row=>({...row,...groupStatus(row.tasks),name:groupName(row.group,row.tasks,snapshot.project)}))
    .sort((a,b)=>Math.max(0,...b.tasks.map(t=>t.queue_order))-Math.max(0,...a.tasks.map(t=>t.queue_order)));
}
