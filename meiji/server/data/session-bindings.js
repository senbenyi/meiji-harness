import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { assertId, invalid } from "../../shared/task-contract.js";
const session = /^session-[a-f0-9-]{36}$/i;
export class SessionBindings {
  #root;
  #tail = Promise.resolve();
  constructor(root) {
    this.#root = root;
  }
  async read() {
    try {
      return JSON.parse(
        await readFile(join(this.#root, "bindings-v1.json"), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") return { sessions: {}, workspaces: {} };
      throw error;
    }
  }
  async #change(fn) {
    const run = this.#tail
      .catch(() => {})
      .then(async () => {
        const state = await this.read(),
          result = await fn(state);
        await mkdir(this.#root, { recursive: true });
        const temp = join(this.#root, `.bindings-${randomUUID()}.json`);
        await writeFile(temp, JSON.stringify(state), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temp, join(this.#root, "bindings-v1.json"));
        return result;
      });
    this.#tail = run;
    return run;
  }
  async projectForSession(id) {
    if (!session.test(id || "")) return null;
    return (await this.read()).sessions[id] || null;
  }
  async bind(id, projectId) {
    if (!session.test(id)) invalid("session_id", "当前会话无效");
    assertId(projectId, "project_id");
    return this.#change((s) => {
      if (s.sessions[id] && s.sessions[id] !== projectId)
        invalid("session_id", "当前会话已关联其他项目，请使用新会话");
      s.sessions[id] = projectId;
      return { session_id: id, project_id: projectId };
    });
  }
  async sessionForProject(projectId) {
    return Object.entries((await this.read()).sessions)
      .find(([, id]) => id === projectId)?.[0] || null;
  }
  async require(id, projectId) {
    if ((await this.projectForSession(id)) !== projectId)
      throw Object.assign(new Error("当前会话未绑定此项目"), {
        status: 403,
        code: "PROJECT_BINDING_MISMATCH",
      });
  }
  async forget(projectId) {
    return this.#change((s) => {
      for (const [id, p] of Object.entries(s.sessions))
        if (p === projectId) delete s.sessions[id];
      delete s.workspaces[projectId];
    });
  }
  async workspace(projectId, create) {
    return this.#change(async (s) => {
      if (!s.workspaces[projectId]) s.workspaces[projectId] = await create();
      return s.workspaces[projectId];
    });
  }
}
