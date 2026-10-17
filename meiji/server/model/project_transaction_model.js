import { validateProject } from "../../shared/project_contract.js";

// 读取闭包只由 Repository 持有。没有可绕过持久化的公开 publish/set 方法。
export class ProjectModel {
  #read;
  #commit;
  #history;
  constructor(read, commit, history = () => ({ groups: [], tasks: [], steps: [] })) {
    validateProject(read().project);
    this.#read = read;
    this.#commit = commit;
    this.#history = history;
  }
  get id() {
    return this.#read().project.id;
  }
  read() {
    return structuredClone(this.#read());
  }
  // 仅用于测试与诊断：工作快照加数据库中已结束的任务历史（不含提示词与 HTTP）。业务代码按 ID 查询，不使用此方法。
  readAll() {
    const live = this.read(), stored = this.#history();
    const merge = (rows, current) => {
      const ids = new Set(current.map(row => row.id));
      return [...rows.filter(row => !ids.has(row.id)), ...current];
    };
    return {
      ...live,
      groups: merge(stored.groups, live.groups),
      tasks: merge(stored.tasks, live.tasks),
      steps: merge(stored.steps, live.steps),
    };
  }
  // 只复制所选部分，避免为读取少量记录深拷贝整个项目（含全部步骤记录）。
  select(pick) {
    return structuredClone(pick(this.#read()));
  }
  update(requestId, input, mutate) {
    return this.#commit(requestId, input, mutate);
  }
}
