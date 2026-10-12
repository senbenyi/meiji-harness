import { DatabaseSync } from "node:sqlite";
import { readFileSync, chmodSync, lstatSync } from "node:fs";

const columns = {
  task_groups: "id project_id episode_id name group_type action source shot_ids_json opinion continued_from_group_id created_at position".split(" "),
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
          version = 2;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      } else if (version === 1) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          const projects = this.#db.prepare("SELECT id,data_json FROM projects").all(),
            saveProject = this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?");
          for (const row of projects) {
            const project = JSON.parse(row.data_json);
            let changed = false;
            for (const episode of project.剧集 || [])
              if (Object.hasOwn(episode, "本集资产")) {
                delete episode.本集资产;
                changed = true;
              }
            for (const rule of project.规则 || [])
              if (rule.适用业务?.includes("episode-characters")) {
                rule.适用业务 = rule.适用业务.filter((business) => business !== "episode-characters");
                changed = true;
              }
            if (changed) saveProject.run(JSON.stringify(project), row.id);
          }
          const now = new Date().toISOString();
          this.#db.prepare(`UPDATE task_steps SET step_status='superseded',error_reason='本集资产功能已移除',ended_at=?
            WHERE task_id IN (SELECT id FROM tasks WHERE business_type='episode-characters' AND task_status IN ('queued','running'))
              AND step_status IN ('ready','running')`).run(now);
          this.#db.prepare(`UPDATE tasks SET task_status='superseded',end_reason='本集资产功能已移除',ended_at=?
            WHERE business_type='episode-characters' AND task_status IN ('queued','running')`).run(now);
          this.#db.prepare("INSERT INTO schema_migrations VALUES (2,?)").run(now);
          this.#db.exec("PRAGMA user_version=2; COMMIT");
          version = 2;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      } else if (version !== 2) throw new Error(`不支持的数据库版本：${version}`);
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
          revision: p.revision, queue_stopped: Boolean(p.queue_stopped),
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
      this.#db.prepare("INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision,queue_stopped=excluded.queue_stopped")
        .run(id, JSON.stringify(snapshot.project), snapshot.runtime.revision, Number(snapshot.runtime.queue_stopped));
      checkpoint("after-project", snapshot);
      for (const [table, key] of [["task_groups", "groups"], ["tasks", "tasks"], ["task_steps", "steps"]]) {
        const old = new Map((before?.[key] || []).map((r, i) => [r.id, { row: r, position: i }]));
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
