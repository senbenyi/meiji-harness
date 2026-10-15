import { migrateNodeDataStates } from './node-data-state-migration.js';
import { migrateSecondsContinuity } from './seconds-continuity-migration.js';
import { normalizeScriptNode, isScriptNodeNormalized } from './script-review-migration.js';
import { DatabaseSync } from "node:sqlite";
import { readFileSync, chmodSync, lstatSync } from "node:fs";
import { validateProject } from "../../shared/project_contract.js";
import { detachOutputLanguage, removeProjectRules, splitFailureMessages } from "../../shared/node-dependencies.js";

const columns = {
  task_groups: "id project_id episode_id name group_type action source shot_ids_json created_at position".split(" "),
  tasks: "id project_id group_id group_seq name business_type target_id episode_id action source task_status queue_order opinion previous_node_state_json end_reason created_at started_at ended_at position".split(" "),
  task_steps: "id project_id task_id seq name kind round step_status prompt_json result_json error_reason started_at ended_at position".split(" "),
};
const conflict = () => Object.assign(new Error("项目版本已变化，请刷新后重试"), { code: "REVISION_CONFLICT", status: 409 });
// 事务内全部同步执行，禁止在持有 SQLite 写锁时等待网络或其他异步工作。
export class SQLiteStore {
  #db;
  #upserts = new Map();
  constructor(path) {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("数据库路径不是普通文件"), { code: "INVALID_STORAGE" });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.#db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      let version = this.#db.prepare("PRAGMA user_version").get().user_version;
      if (version === 0) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
          this.#db.exec("COMMIT");
          version = 18;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 9) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          const projects = this.#db.prepare("SELECT id, data_json FROM projects").all();
          const taskRows = this.#db.prepare("SELECT id, project_id, business_type, target_id, previous_node_state_json FROM tasks").all();
          const updateProject = this.#db.prepare("UPDATE projects SET data_json=? WHERE id=?");
          const updateTask = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
          for (const row of projects) {
            const project = JSON.parse(row.data_json);
            const tasks = taskRows.filter(task => task.project_id === row.id).map(task => ({
              id: task.id, business_type: task.business_type, target_id: task.target_id,
              previous_node_state: task.previous_node_state_json ? JSON.parse(task.previous_node_state_json) : null,
            }));
            removeProjectRules({ project, tasks, steps: [] });
            updateProject.run(JSON.stringify(project), row.id);
            for (const task of tasks) if (task.previous_node_state) updateTask.run(JSON.stringify(task.previous_node_state), task.id);
          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (10, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=10");
          this.#db.exec("COMMIT");
          version = 10;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 10) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          const projects = this.#db.prepare("SELECT id, data_json FROM projects").all();
          const taskRows = this.#db.prepare("SELECT id, project_id, business_type, target_id, previous_node_state_json FROM tasks").all();
          const updateProject = this.#db.prepare("UPDATE projects SET data_json=? WHERE id=?");
          const updateTask = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
          for (const row of projects) {
            const project = JSON.parse(row.data_json);
            const tasks = taskRows.filter(task => task.project_id === row.id).map(task => ({
              id: task.id, business_type: task.business_type, target_id: task.target_id,
              previous_node_state: task.previous_node_state_json ? JSON.parse(task.previous_node_state_json) : null,
            }));
            detachOutputLanguage({ project, tasks, steps: [] });
            splitFailureMessages({ project, tasks });
            updateProject.run(JSON.stringify(project), row.id);
            for (const task of tasks) if (task.previous_node_state) updateTask.run(JSON.stringify(task.previous_node_state), task.id);
          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (11, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=11");
          this.#db.exec("COMMIT");
          version = 11;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 11) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          const projects = this.#db.prepare("SELECT id, data_json FROM projects").all();
          const taskRows = this.#db.prepare("SELECT id, project_id, previous_node_state_json FROM tasks").all();
          const updateProject = this.#db.prepare("UPDATE projects SET data_json=? WHERE id=?");
          const updateTask = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
          for (const row of projects) {
            const project = JSON.parse(row.data_json);
            const tasks = taskRows.filter(task => task.project_id === row.id).map(task => ({
              id: task.id,
              previous_node_state: task.previous_node_state_json ? JSON.parse(task.previous_node_state_json) : null,
            }));
            splitFailureMessages({ project, tasks });
            updateProject.run(JSON.stringify(project), row.id);
            for (const task of tasks) if (task.previous_node_state) updateTask.run(JSON.stringify(task.previous_node_state), task.id);
          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (12, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=12");
          this.#db.exec("COMMIT");
          version = 12;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 12) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          const projects = this.#db.prepare("SELECT id, data_json FROM projects").all();
          const taskRows = this.#db.prepare("SELECT id, project_id, business_type, target_id, task_status, previous_node_state_json FROM tasks").all();
          const updateProject = this.#db.prepare("UPDATE projects SET data_json=?, revision=revision+1 WHERE id=?");
          const updateTask = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
          for (const row of projects) {
            const project = JSON.parse(row.data_json);
            const tasks = taskRows.filter(task => task.project_id === row.id).map(task => ({ ...task,
              previous_node_state: task.previous_node_state_json ? JSON.parse(task.previous_node_state_json) : null,
            }));
            migrateSecondsContinuity({ project, tasks, steps: [] });
            const validating = structuredClone({ project, tasks });
            migrateNodeDataStates(validating);
            validateProject(normalizeScriptNode(validating.project));
            updateProject.run(JSON.stringify(project), row.id);
            for (const task of tasks) if (task.previous_node_state) updateTask.run(JSON.stringify(task.previous_node_state), task.id);
          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (13, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=13");
          this.#db.exec("COMMIT");
          version = 13;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 13) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db.exec("ALTER TABLE projects DROP COLUMN queue_stopped");
          this.#db.prepare("INSERT INTO schema_migrations VALUES (14, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=14; COMMIT");
          version = 14;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 14) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
            const project=JSON.parse(row.data_json);
            const tasks=this.#db.prepare("SELECT * FROM tasks WHERE project_id=? ORDER BY queue_order").all(row.id)
              .map(t=>({...t,previous_node_state:t.previous_node_state_json?JSON.parse(t.previous_node_state_json):null}));
            migrateNodeDataStates({project,tasks});
            validateProject(normalizeScriptNode(structuredClone(project)));
            this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?").run(JSON.stringify(project),row.id);
            for(const task of tasks.filter(t=>['queued','running'].includes(t.task_status)))
              this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?").run(JSON.stringify(task.previous_node_state),task.id);
          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (15,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=15; COMMIT");
          version=15;
        } catch(error) {this.#db.exec("ROLLBACK");throw error;}
      }
      // v16 曾新增独立 script_review 节点，v17 将其并为剧本节点并附审核结论，v18 只保留剧本节点状态。
      // 各步都归一为 v18 形态，已是该形态的项目不改写。
      for (const [from, to] of [[15, 16], [16, 17], [17, 18]]) {
        if (version !== from) continue;
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
            const project = JSON.parse(row.data_json);
            if (isScriptNodeNormalized(project)) continue;
            validateProject(normalizeScriptNode(project));
            this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?").run(JSON.stringify(project), row.id);
          }
          this.#db.prepare(`INSERT INTO schema_migrations VALUES (${to},strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run();
          this.#db.exec(`PRAGMA user_version=${to}; COMMIT`);
          version = to;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version !== 18) throw new Error(`不支持的数据库版本：${version}`);
      for (const [table, fields] of Object.entries(columns)) {
        this.#upserts.set(table, this.#db.prepare(`INSERT INTO ${table} (${fields}) VALUES (${fields.map(() => "?")}) ON CONFLICT(id) DO UPDATE SET ${fields.filter(f => f !== "id").map(f => `${f}=excluded.${f}`).join(",")}`));
      }
    } catch (error) { this.#db.close(); throw error; }
  }
  list() { return this.#db.prepare("SELECT id FROM projects ORDER BY rowid").all().map(r => r.id); }
  read(id) {
    // 所有表在同一个读事务内，跨连接也不会拼出不同版本的快照。
    this.#db.exec("BEGIN");
    try {
      const p = this.#db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      if (!p) return null;
      const rows = (table) => this.#db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY position`).all(id);
      const decode = (row, step = false) => {
        const data = { ...row };
        delete data.position;
        if (step) delete data.project_id;
        if (data.name === null) delete data.name;
        for (const key of Object.keys(data)) if (key.endsWith("_json")) {
          data[key.slice(0, -5)] = JSON.parse(data[key]);
          delete data[key];
        }
        return data;
      };
      return {
        project: JSON.parse(p.data_json),
        groups: rows("task_groups").map(r => decode(r)),
        tasks: rows("tasks").map(r => decode(r)),
        steps: rows("task_steps").map(r => decode(r, true)),
        runtime: {
          revision: p.revision,
          requests: rows("command_requests").map(r => ({ id: r.id, input_hash: r.input_hash, result: JSON.parse(r.result_json) })),
          outbox: rows("notification_outbox").map(r => JSON.parse(r.data_json)),
        },
      };
    } finally { this.#db.exec("COMMIT"); }
  }
  write(snapshot, before = null, checkpoint = () => {}) {
    const id = snapshot.project.id;
    this.#db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const existing = this.#db.prepare("SELECT revision FROM projects WHERE id=?").get(id);
      if ((existing?.revision ?? 0) !== (before?.runtime.revision ?? 0)) throw conflict();
      this.#db.prepare("INSERT INTO projects (id,data_json,revision) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision")
        .run(id, JSON.stringify(snapshot.project), snapshot.runtime.revision);
      checkpoint("after-project", snapshot);
      for (const [table, key] of [["task_groups", "groups"], ["tasks", "tasks"], ["task_steps", "steps"]]) {
        const old = new Map((before?.[key] || []).map((r, i) => [r.id, { row: r, position: i }]));
        if (table === 'tasks') {
          // 动态插入编排先腾开被移动任务的位置，避免逐行 upsert 撞组内唯一序号。
          const moved = snapshot.tasks.filter(row => old.has(row.id) && old.get(row.id).row.group_seq !== row.group_seq);
          const offset = Math.max(0, ...snapshot.tasks.map(row => row.group_seq), ...(before?.tasks || []).map(row => row.group_seq)) + 1;
          for (const row of moved) this.#db.prepare('UPDATE tasks SET group_seq=group_seq+? WHERE id=?').run(offset, row.id);
        }
        snapshot[key].forEach((row, position) => {
          const previous = old.get(row.id);
          if (previous?.position === position && JSON.stringify(previous.row) === JSON.stringify(row)) return;
          const record = { ...row, project_id: id, position };
          const values = columns[table].map(k => k.endsWith("_json") ? JSON.stringify(record[k.slice(0, -5)]) : record[k] ?? null);
          this.#upserts.get(table).run(...values);
        });
        checkpoint(`after-${key}`, snapshot);
      }
      const request = this.#db.prepare("INSERT INTO command_requests VALUES (?,?,?,?,?)");
      snapshot.runtime.requests.slice(before?.runtime.requests.length || 0).forEach((r, i) => request.run(id, r.id, r.input_hash, JSON.stringify(r.result), (before?.runtime.requests.length || 0) + i));
      const notice = this.#db.prepare("INSERT INTO notification_outbox VALUES (?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET data_json=excluded.data_json,position=excluded.position");
      const previousNotices = new Map((before?.runtime.outbox || []).map(r => [r.id, JSON.stringify(r)]));
      snapshot.runtime.outbox.forEach((r, i) => {
        const json = JSON.stringify(r);
        if (previousNotices.get(r.id) !== json) notice.run(id, r.id, json, i);
      });
      checkpoint("after-runtime", snapshot);
      checkpoint("before-commit", snapshot);
      this.#db.exec("COMMIT");
      committed = true;
      checkpoint("after-commit", snapshot);
    } catch (error) {
      if (!committed) this.#db.exec("ROLLBACK");
      else Object.assign(error, { code: "COMMIT_ACCEPTED", committed: true, revision: snapshot.runtime.revision });
      throw error;
    }
  }
  remove(id, revision) {
    const result = this.#db.prepare("DELETE FROM projects WHERE id=? AND revision=?").run(id, revision);
    if (!result.changes) throw conflict();
  }
  close() { this.#db.close(); }
}
