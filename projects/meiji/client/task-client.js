const unfinished = task => ['queued', 'running'].includes(task.task_status);
export class PanelContext {
  #epoch = 0;
  #snapshot = null;
  #session = null;
  #project = null;
  #records = new Map();
  #missing = new Set();
  select(sessionId, projectId) {
    this.#epoch++;
    this.#session = sessionId;
    this.#project = projectId;
    this.#snapshot = null;
    this.#records.clear(); this.#missing.clear();
    return this.token();
  }
  token() { return { epoch: this.#epoch, session_id: this.#session, project_id: this.#project }; }
  valid(token) {
    return token.epoch === this.#epoch && token.session_id === this.#session && token.project_id === this.#project;
  }
  #merge(groups) {
    const snapshot = this.#snapshot;
    for (const view of groups || []) {
      if (!view?.group?.id || !Array.isArray(view.tasks) || (view.group.project_id && view.group.project_id !== this.#project)) continue;
      if (view.tasks.some(unfinished)) this.#records.delete(view.group.id);
      else this.#records.set(view.group.id, view);
      const taskIds = new Set(snapshot.tasks.filter(t => t.group_id === view.group.id).map(t => t.id));
      snapshot.tasks = snapshot.tasks.filter(t => t.group_id !== view.group.id);
      snapshot.steps = snapshot.steps.filter(st => !taskIds.has(st.task_id));
      snapshot.groups = snapshot.groups.filter(g => g.id !== view.group.id);
      if (view.tasks.some(unfinished)) {
        snapshot.tasks.push(...view.tasks); snapshot.steps.push(...(view.steps || [])); snapshot.groups.push(view.group);
      }
    }
  }
  mergeGroups(groups, revision, links) {
    const snapshot = this.#snapshot;
    if (!snapshot || (revision != null && revision < snapshot.runtime.revision)) return false;
    if (!groups?.length && !links) return false;
    this.#merge(groups);
    for (const key of ['latest_tasks', 'latest_groups']) {
      if (links?.[key]) Object.assign(snapshot.project[key] ??= {}, links[key]);
    }
    if (revision != null) snapshot.runtime.revision = Math.max(snapshot.runtime.revision || 0, revision);
    return true;
  }
  accept(token, snapshot) {
    if (!this.valid(token) || snapshot.project.basic_info.id !== this.#project || snapshot.runtime.revision < (this.#snapshot?.runtime.revision || 0)) return false;
    this.#snapshot = snapshot;
    const tasks = new Set(Object.values(snapshot.project.latest_tasks || {})), groups = new Set(Object.values(snapshot.project.latest_groups || {}));
    for (const [id, view] of this.#records) if (view.tasks.some(unfinished) || (!groups.has(id) && !view.tasks.some(t => tasks.has(t.id)))) this.#records.delete(id);
    // 仅缓存按最近关联读到的组；切换项目由 select 清空，不把历史分页塞入主快照。
    return true;
  }
  neededRecords() {
    const s = this.read();
    if (!s) return { task_ids: [], group_ids: [] };
    return {
      task_ids: [...new Set(Object.values(s.project.latest_tasks || {}))].filter(id => !s.tasks.some(t => t.id === id) && !this.#missing.has(id)),
      group_ids: [...new Set(Object.values(s.project.latest_groups || {}))].filter(id => !s.groups.some(g => g.id === id) && !this.#missing.has(id)),
    };
  }
  acceptRecords(token, data, requested) {
    if (!this.valid(token) || !this.#snapshot || data.revision < this.#snapshot.runtime.revision) return false;
    // 只补充缓存，不凭历史查询结果推进项目版本；更新版本仍由快照或事件提供。
    for (const group of data.groups || []) this.#records.set(group.group.id, group);
    const found = new Set((data.groups || []).flatMap(g => [g.group.id, ...g.tasks.map(t => t.id)]));
    for (const id of [...requested.task_ids, ...requested.group_ids]) if (!found.has(id)) this.#missing.add(id);
    return true;
  }
  recordChanged(record) {
    const step = this.#snapshot?.steps.find(st => st.id === record.step_id);
    if (step) for (const key of ['has_prompt', 'has_http']) if (key in record) step[key] = record[key];
  }
  read() {
    const s = this.#snapshot;
    if (!s) return null;
    const taskIds = new Set(Object.values(s.project.latest_tasks || {})), groupIds = new Set(Object.values(s.project.latest_groups || {}));
    for (const [id, view] of this.#records) if (!groupIds.has(id) && !view.tasks.some(t => taskIds.has(t.id))) this.#records.delete(id);
    const groups = [...this.#records.values()];
    const liveIds = new Set(s.groups.map(g => g.id));
    const cached = groups.filter(g => !liveIds.has(g.group.id));
    return { ...s, groups: [...s.groups, ...cached.map(g => g.group)], tasks: [...s.tasks, ...cached.flatMap(g => g.tasks)], steps: [...s.steps, ...cached.flatMap(g => g.steps || [])] };
  }
}
export async function request(path, options = {}) {
  const response = await fetch("/api/meiji/" + path, options),
    value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.message || "请求失败"), value);
  return value;
}
export function sendCommand(sessionId, command, project = false) {
  return request(project ? "project-command" : "task-command", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Meiji-Request": "1" },
    body: JSON.stringify({ session_id: sessionId, command }),
  });
}
export function currentSessionId() {
  try {
    const selected = JSON.parse(
      window.localStorage.getItem("dsh.sessions.current") || "null",
    );
    if (/^session-[a-f0-9-]{36}$/i.test(selected?.sessionId || ""))
      return selected.sessionId;
  } catch {}
  const match =
    window.location.pathname.match(/\/session\/(session-[a-f0-9-]+)/i) ||
    window.location.pathname.match(/\/(session-[a-f0-9-]+)/i);
  return (
    match?.[1] ||
    new URLSearchParams(window.location.search).get("sessionId") ||
    null
  );
}
