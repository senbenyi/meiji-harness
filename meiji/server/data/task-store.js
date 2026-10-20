import { groupStatus, groupName } from "../../shared/task-labels.js";
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

// 面板与推送只带步骤状态和是否有记录；提示词与 HTTP 在打开任务组详情时按组读取。
export function lightStep(step) {
  const { prompt, http, ...rest } = step;
  return {
    ...rest,
    has_prompt: Object.hasOwn(step, "prompt") ? prompt != null : Boolean(step.has_prompt),
    has_http: Object.hasOwn(step, "http") ? Array.isArray(http) && http.length > 0 : Boolean(step.has_http),
  };
}

// 节点只接收本组任务和步骤状态，不附带历史提示词。
export function groupView(snapshot, groupId) {
  const detail = groupDetail({ read: () => snapshot }, groupId);
  if (!detail) return null;
  return { ...detail, steps: detail.steps.map(lightStep) };
}

// 任务组摘要（不含提示词与 HTTP）：组、任务、步骤状态，附聚合状态与名称。
export function groupSummary(record, project) {
  if (!record) return null;
  return { ...record, steps: record.steps.map(lightStep), ...groupStatus(record.tasks), name: groupName(record.group, record.tasks, project) };
}

// 任务组详情：从数据库读取本组全部步骤的提示词与 HTTP；运行中步骤以任务管理器内存记录为准。
export function groupDetailRecords(history, liveRecords, groupId, project, revision) {
  const record = history.group(groupId, { records: true });
  if (!record) return null;
  const steps = record.steps.map(step => liveRecords.has(step.id) ? { ...step, ...structuredClone(liveRecords.get(step.id)) } : step);
  return { ...record, steps, ...groupStatus(record.tasks), name: groupName(record.group, record.tasks, project), revision };
}

// 任务历史列表：按状态、节点类型、剧集筛选后分页；只读任务组与任务，不读步骤。
export function historyPage(history, project, { status = "", business = "", episode = "", offset = 0, limit = 50 } = {}) {
  const { groups, tasks } = history.historyRows();
  const members = new Map();
  for (const task of tasks) (members.get(task.group_id) || members.set(task.group_id, []).get(task.group_id)).push(task);
  const latest = row => Math.max(0, ...row.tasks.map(task => task.queue_order));
  const rows = groups.map(group => ({ group, tasks: members.get(group.id) || [] })).filter(row => row.tasks.length)
    .map(row => ({ ...row, ...groupStatus(row.tasks), name: groupName(row.group, row.tasks, project) }))
    .sort((a, b) => latest(b) - latest(a))
    .filter(row => (!status || row.status === status)
      && (!business || row.tasks.some(task => task.business_type === business))
      && (!episode || row.tasks.some(task => task.episode_id === episode)));
  return { total: rows.length, offset, limit, groups: rows.slice(offset, offset + limit) };
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

// 历史展示只需名称/序号，先投影再复制；不为查看一组记录深拷贝剧本、镜头正文或媒体。
export function historyContext(model) {
  return model.select(({ project: p, runtime }) => ({
    revision: runtime.revision,
    project: {
      id: p.basic_info.id, name: p.basic_info.name,
      scene_library: { scenes: p.scene_library.scenes.map(({ id, name }) => ({ id, name })) },
      character_library: { characters: p.character_library.characters.map(({ id, name, costumes }) => ({ id, name, costumes: costumes.map(({ id, name }) => ({ id, name })) })) },
      episodes: p.episodes.map(({ id, sequence, shot_list }) => ({ id, sequence, shot_list: { shots: shot_list.shots.map(({ id, number }) => ({ id, number })) } })),
    },
  }));
}
