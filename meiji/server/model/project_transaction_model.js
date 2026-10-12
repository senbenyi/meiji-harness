import { validateProject } from "../../shared/project_contract.js";

// 读取闭包只由 Repository 持有。没有可绕过持久化的公开 publish/set 方法。
export class ProjectModel {
  #read;
  #commit;
  constructor(read, commit) {
    validateProject(read().project);
    this.#read = read;
    this.#commit = commit;
  }
  get id() {
    return this.#read().project.id;
  }
  read() {
    return structuredClone(this.#read());
  }
  update(requestId, input, mutate) {
    return this.#commit(requestId, input, mutate);
  }
}
