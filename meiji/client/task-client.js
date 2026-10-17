export class PanelContext {
  #epoch = 0;
  #snapshot = null;
  #session = null;
  #project = null;
  select(sessionId, projectId) {
    this.#epoch++;
    this.#session = sessionId;
    this.#project = projectId;
    this.#snapshot = null;
    return this.token();
  }
  token() {
    return {
      epoch: this.#epoch,
      session_id: this.#session,
      project_id: this.#project,
    };
  }
  mergeGroups(groups, revision) {
    const snapshot = this.#snapshot;
    if (!snapshot || !groups?.length) return false;
    if (revision != null && revision < snapshot.runtime.revision) return false;
    for (const view of groups) {
      if (!view?.group?.id || !Array.isArray(view.tasks)) continue;
      const taskIds = new Set(view.tasks.map(task => task.id));
      snapshot.tasks = snapshot.tasks.filter(task => task.group_id !== view.group.id && !taskIds.has(task.id)).concat(view.tasks);
      snapshot.steps = snapshot.steps.filter(step => !taskIds.has(step.task_id)).concat(view.steps || []);
      snapshot.groups = snapshot.groups.filter(group => group.id !== view.group.id).concat(view.group);
    }
    if (revision != null) snapshot.runtime.revision = Math.max(snapshot.runtime.revision || 0, revision);
    return true;
  }
  accept(token, snapshot) {
    if (
      token.epoch !== this.#epoch ||
      token.session_id !== this.#session ||
      token.project_id !== this.#project ||
      snapshot.project.id !== this.#project ||
      snapshot.runtime.revision < (this.#snapshot?.runtime.revision || 0)
    )
      return false;
    this.#snapshot = snapshot;
    return true;
  }
  read() {
    return this.#snapshot;
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
