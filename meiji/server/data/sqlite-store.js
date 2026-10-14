import { DatabaseSync } from "node:sqlite";
import { readFileSync, chmodSync, lstatSync } from "node:fs";
import { migrateProjectModelV3, migrateEpisodeNodesV4, migrateCharacterListsV5, migrateCharacterPortraitsV6 } from "../../shared/models/migrate_project_model.js";
import { validateProject } from "../../shared/project_contract.js";
import { expireDownstream } from "../../shared/node-dependencies.js";

const columns = {
  task_groups: "id project_id episode_id name group_type action source shot_ids_json created_at position".split(" "),
  tasks: "id project_id group_id group_seq name business_type target_id episode_id action source task_status queue_order opinion previous_node_state_json end_reason created_at started_at ended_at position".split(" "),
  task_steps: "id project_id task_id seq name kind round step_status prompt_json result_json error_reason started_at ended_at position".split(" "),
};
const conflict = () => Object.assign(new Error("项目版本已变化，请刷新后重试"), { code: "REVISION_CONFLICT", status: 409 });
const addDependencyHash = (project) => {
  const touch = (node) => {
    if (!node || typeof node !== "object" || Object.hasOwn(node, "依赖hash")) return false;
    node.依赖hash = "";
    return true;
  };
  let changed = false;
  for (const node of [project.项目摘要, project.角色库]) changed = touch(node) || changed;
  for (const character of project.角色库?.角色 || []) {
    changed = touch(character.图片) || changed;
    for (const costume of character.服装 || []) changed = touch(costume.图片) || changed;
  }
  for (const episode of project.剧集 || []) {
    for (const node of [episode.摘要, episode.故事大纲, episode.镜头表, episode.合片])
      changed = touch(node) || changed;
    for (const shot of episode.镜头表?.镜头 || [])
      for (const node of [shot.每秒分镜, shot.文本提示词, shot.视频, shot.尾帧])
        changed = touch(node) || changed;
  }
  return changed;
};

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
      if (version > 0 && version < 7) {
        // VACUUM INTO 包含 WAL 中已提交的数据；升级失败时保留可恢复副本。
        const backupPath = `${path}.before-v7-${Date.now()}-${globalThis.crypto.randomUUID()}.sqlite`;
        this.#db.prepare("VACUUM INTO ?").run(backupPath);
        chmodSync(backupPath, 0o600);
      }
      if (version === 0) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
          this.#db.exec("COMMIT");
          version = 7;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      } else if (version > 0 && version < 7) {
        // 所有版本过渡和数据校验在同一事务内；失败时连同版本号一起回滚。
        this.#db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
        try {
          if (version === 1) {
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
            this.#db.exec("PRAGMA user_version=2");
            version = 2;
          }
          if (version === 2) {
            const projects = this.#db.prepare("SELECT id,data_json FROM projects").all(),
              saveProject = this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?");
            for (const row of projects) {
              const project = JSON.parse(row.data_json);
              if (addDependencyHash(project)) saveProject.run(JSON.stringify(project), row.id);
            }
            this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (3,?)").run(new Date().toISOString());
            this.#db.exec("PRAGMA user_version=3");
            version = 3;
          }
          if (version === 3) {
            const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
            for (const table of ["task_groups", "task_steps"]) {
              const start = schema.indexOf(`CREATE TABLE ${table} (`);
              const definition = start < 0 ? null : schema.slice(start, schema.indexOf(") STRICT;", start) + ") STRICT;".length);
              if (!definition) throw new Error(`缺少表结构：${table}`);
              this.#db.exec(definition.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_v4`));
              const fields = columns[table].join(",");
              this.#db.exec(`INSERT INTO ${table}_v4 (${fields}) SELECT ${fields} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_v4 RENAME TO ${table};`);
            }
            this.#db.exec("CREATE INDEX group_history ON task_groups(project_id,created_at DESC,id); CREATE INDEX steps_project ON task_steps(project_id);");
            const updateProject = this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?");
            for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
              const project = migrateProjectModelV3(JSON.parse(row.data_json));
              validateProject(project);
              updateProject.run(JSON.stringify(project), row.id);
            }
            const updateState = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
            for (const row of this.#db.prepare("SELECT id,previous_node_state_json FROM tasks").all()) {
              const previous = JSON.parse(row.previous_node_state_json);
              if (previous && Object.hasOwn(previous, "状态"))
                updateState.run(JSON.stringify({ status: previous.状态, reason: previous.原因 }), row.id);
            }
            const now = new Date().toISOString();
            this.#db.prepare(`UPDATE task_steps SET step_status='superseded',error_reason='剧本生成任务已移除',ended_at=?
              WHERE task_id IN (SELECT id FROM tasks WHERE business_type='script' AND task_status IN ('queued','running')) AND step_status IN ('ready','running')`).run(now);
            this.#db.prepare("UPDATE tasks SET task_status='superseded',end_reason='剧本生成任务已移除',ended_at=? WHERE business_type='script' AND task_status IN ('queued','running')").run(now);
            if (this.#db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("迁移后的任务归属无效");
            this.#db.prepare("INSERT INTO schema_migrations VALUES (4,?)").run(now);
            this.#db.exec("PRAGMA user_version=4");
            version = 4;
          }
          if (version === 4) {
            const updateProject = this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?");
            const updateState = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
            for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
              const project = migrateCharacterPortraitsV6(migrateCharacterListsV5(JSON.parse(row.data_json)));
              validateProject(project);
              const tasks = this.#db.prepare("SELECT * FROM tasks WHERE project_id=?").all(row.id)
                .map(task => ({ ...task, previous_node_state: JSON.parse(task.previous_node_state_json) }));
              const steps = this.#db.prepare("SELECT * FROM task_steps WHERE project_id=?").all(row.id)
                .map(step => ({ ...step, result: JSON.parse(step.result_json) }));
              migrateEpisodeNodesV4({ project, tasks, steps });
              validateProject(project);
              updateProject.run(JSON.stringify(project), row.id);
              for (const task of tasks)
                if (task.task_status === "queued" && JSON.stringify(task.previous_node_state) !== task.previous_node_state_json)
                  updateState.run(JSON.stringify(task.previous_node_state), task.id);
            }
            this.#db.prepare("INSERT INTO schema_migrations VALUES (5,?)").run(new Date().toISOString());
            this.#db.exec("PRAGMA user_version=5");
            version = 5;
          }
          if (version === 5) {
            const saveProject = this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?");
            const saveState = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
            for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
              const project = migrateCharacterPortraitsV6(migrateCharacterListsV5(JSON.parse(row.data_json)));
              validateProject(project);
              const tasks = this.#db.prepare("SELECT * FROM tasks WHERE project_id=?").all(row.id)
                .map(task => ({ ...task, previous_node_state: JSON.parse(task.previous_node_state_json) }));
              const steps = this.#db.prepare("SELECT * FROM task_steps WHERE project_id=?").all(row.id)
                .map(step => ({ ...step, result: JSON.parse(step.result_json) }));
              const snapshot = { project, tasks, steps };
              for (const character of project.character_library.characters)
                expireDownstream(snapshot, "character-setting", character.id, "角色数组字段已更新，请重新生成");
              validateProject(project);
              saveProject.run(JSON.stringify(project), row.id);
              for (const task of tasks)
                if (task.task_status === "queued" && JSON.stringify(task.previous_node_state) !== task.previous_node_state_json)
                  saveState.run(JSON.stringify(task.previous_node_state), task.id);
            }
            this.#db.prepare("INSERT INTO schema_migrations VALUES (6,?)").run(new Date().toISOString());
            this.#db.exec("PRAGMA user_version=6");
            version = 6;
          }
          if (version === 6) {
            const now = new Date().toISOString();
            this.#db.prepare(`UPDATE task_steps SET step_status='superseded',error_reason='独立角色图生成已移除',ended_at=?
              WHERE task_id IN (SELECT id FROM tasks WHERE business_type='character-image' AND task_status IN ('queued','running'))
              AND step_status IN ('ready','running')`).run(now);
            this.#db.prepare(`UPDATE tasks SET task_status='superseded',end_reason='独立角色图生成已移除',ended_at=?
              WHERE business_type='character-image' AND task_status IN ('queued','running')`).run(now);
            const saveProject = this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?");
            const saveState = this.#db.prepare("UPDATE tasks SET previous_node_state_json=? WHERE id=?");
            for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
              const project = migrateCharacterPortraitsV6(JSON.parse(row.data_json));
              const tasks = this.#db.prepare("SELECT * FROM tasks WHERE project_id=?").all(row.id)
                .map(task => ({ ...task, previous_node_state: JSON.parse(task.previous_node_state_json) }));
              const snapshot = { project, tasks, steps: [] };
              for (const character of project.character_library.characters) {
                for (const image of character.costume_images) {
                  if (["queued", "running"].includes(image.node_state.status) && !tasks.some(task =>
                    task.business_type === "costume-image" && task.target_id === (image.costume_id || character.id) &&
                    ["queued", "running"].includes(task.task_status)))
                    Object.assign(image.node_state, { status: "cancelled", reason: "独立角色图生成已移除" });
                }
                expireDownstream(snapshot, "character-setting", character.id, "定妆照依赖已更新，请重新生成");
              }
              validateProject(project);
              saveProject.run(JSON.stringify(project), row.id);
              for (const task of tasks)
                if (task.task_status === "queued" && JSON.stringify(task.previous_node_state) !== task.previous_node_state_json)
                  saveState.run(JSON.stringify(task.previous_node_state), task.id);
            }
            this.#db.prepare("INSERT INTO schema_migrations VALUES (7,?)").run(now);
            this.#db.exec("PRAGMA user_version=7");
            version = 7;
          }
          this.#db.exec("COMMIT");
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
        finally { this.#db.exec("PRAGMA foreign_keys=ON"); }
      }
      if (version !== 7) throw new Error(`不支持的数据库版本：${version}`);
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
