import { initializeScriptAdaptation } from './script-adaptation-migration.js';
import { initializeSupplementRules, migrateSupplementRules } from './supplement-rules-migration.js';
import { migrateAspectRatio } from './aspect-ratio-migration.js';
import { splitLegacyPrompt } from './step-records.js';
import { stepExecutor } from '../../shared/task-plan.js';
import { migrateScenes } from './scene-migration.js';
import { migrateShotCast } from './shot-cast-migration.js';
import { removeCharacterNumbers, migrateCharacterIds } from './character-id-migration.js';
import { migrateNodeDataStates } from './node-data-state-migration.js';
import { migrateSecondsContinuity } from './seconds-continuity-migration.js';
import { normalizeScriptNode, isScriptNodeNormalized } from './script-review-migration.js';
import { DatabaseSync } from "node:sqlite";
import { readFileSync, chmodSync, lstatSync } from "node:fs";
import { validateProject as validateCurrentProject } from "../../shared/project_contract.js";
import { detachOutputLanguage, removeProjectRules, splitFailureMessages } from "../../shared/node-dependencies.js";

const validateProject = project => validateCurrentProject(initializeSupplementRules(migrateAspectRatio(migrateScenes(project))));

const columns = {
  task_groups: "id project_id episode_id name group_type action source shot_ids_json created_at position".split(" "),
  tasks: "id project_id group_id group_seq name business_type target_id episode_id action source task_status queue_order opinion previous_node_state_json end_reason created_at started_at ended_at position".split(" "),
  task_steps: "id project_id task_id seq name kind round step_status executor prompt_json http_json result_json error_reason started_at ended_at position".split(" "),
};
const conflict = () => Object.assign(new Error("项目版本已变化，请刷新后重试"), { code: "REVISION_CONFLICT", status: 409 });
// 步骤状态列（不含提示词与 HTTP 记录）。
const stepState = "id,project_id,task_id,seq,name,kind,round,step_status,executor,result_json,error_reason,started_at,ended_at,position";
const decode = (row, step = false) => {
  const data = { ...row };
  delete data.position;
  if (step) delete data.project_id;
  for (const key of ["has_prompt", "has_http"]) if (key in data) data[key] = Boolean(data[key]);
  if (data.name === null) delete data.name;
  for (const key of Object.keys(data)) if (key.endsWith("_json")) {
    data[key.slice(0, -5)] = JSON.parse(data[key]);
    delete data[key];
  }
  return data;
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
      if (version === 0) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
          this.#db.exec("COMMIT");
          version = 22;
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
            validateProject(normalizeScriptNode(migrateShotCast(removeCharacterNumbers(validating.project))));
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
            validateProject(normalizeScriptNode(migrateShotCast(removeCharacterNumbers(structuredClone(project)))));
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
            validateProject(normalizeScriptNode(migrateShotCast(removeCharacterNumbers(project))));
            this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?").run(JSON.stringify(project), row.id);
          }
          this.#db.prepare(`INSERT INTO schema_migrations VALUES (${to},strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run();
          this.#db.exec(`PRAGMA user_version=${to}; COMMIT`);
          version = to;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 18) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
            const project = JSON.parse(row.data_json);
            migrateCharacterIds(project);
            validateProject(project);
            if (JSON.stringify(project) !== row.data_json)
              this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?").run(JSON.stringify(project), row.id);

          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (19,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=19; COMMIT");
          version = 19;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 19) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          for (const row of this.#db.prepare("SELECT id,data_json FROM projects").all()) {
            const project = migrateShotCast(JSON.parse(row.data_json));
            validateProject(project);
            if (JSON.stringify(project) !== row.data_json)
              this.#db.prepare("UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?").run(JSON.stringify(project), row.id);
          }
          const reason = '角色与服装识别已并入镜头表，请重新生成镜头表';
          const now = new Date().toISOString();
          this.#db.prepare("UPDATE task_steps SET step_status='cancelled',error_reason=?,ended_at=? WHERE step_status IN ('ready','running') AND task_id IN (SELECT id FROM tasks WHERE business_type='shot-characters' AND task_status IN ('queued','running'))").run(reason, now);
          this.#db.prepare("UPDATE tasks SET task_status='cancelled',end_reason=?,ended_at=? WHERE business_type='shot-characters' AND task_status IN ('queued','running')").run(reason, now);
          for (const task of this.#db.prepare("SELECT id,previous_node_state_json FROM tasks WHERE task_status IN ('queued','running') AND business_type IN ('shots','seconds','storyboard','first-last-frame','multimodal','video','tail','assembly')").all()) {
            const state = JSON.parse(task.previous_node_state_json);
            if (state?.status === 'generated') {
              Object.assign(state, { status: 'expired', reason });
              this.#db.prepare('UPDATE tasks SET previous_node_state_json=? WHERE id=?').run(JSON.stringify(state), task.id);
            }
          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (20,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec("PRAGMA user_version=20; COMMIT");
          version = 20;
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      if (version === 20) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of this.#db.prepare('SELECT id,data_json FROM projects').all()) {
            const project = migrateScenes(JSON.parse(row.data_json));
            validateProject(project);
            if (JSON.stringify(project) !== row.data_json) this.#db.prepare('UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(project), row.id);
          }
          const reason = '请先提取场景并重新生成带场景绑定的镜头表';
          for (const row of this.#db.prepare("SELECT id,previous_node_state_json FROM tasks WHERE task_status IN ('queued','running') AND business_type IN ('shots','seconds','storyboard','first-last-frame','multimodal','video','tail','assembly')").all()) {
            const state = JSON.parse(row.previous_node_state_json);
            if (state?.status === 'generated') {
              Object.assign(state, {status:'expired',reason,fail_message:''});
              this.#db.prepare('UPDATE tasks SET previous_node_state_json=? WHERE id=?').run(JSON.stringify(state),row.id);
            }
          }
          this.#db.prepare("INSERT INTO schema_migrations VALUES (21,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=21; COMMIT');
          version = 21;
        } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
      }
      if (version === 21) {
        // v22：步骤明确保存执行方式、精简提示词与独立 HTTP 记录。
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          const existing = new Set(this.#db.prepare("PRAGMA table_info(task_steps)").all().map(column => column.name));
          if (!existing.has('executor')) this.#db.exec("ALTER TABLE task_steps ADD COLUMN executor TEXT NOT NULL DEFAULT 'program' CHECK(executor IN ('ai','program'))");
          if (!existing.has('http_json')) this.#db.exec("ALTER TABLE task_steps ADD COLUMN http_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(http_json))");
          const update = this.#db.prepare('UPDATE task_steps SET executor=?,prompt_json=?,http_json=? WHERE id=? AND project_id=?');
          for (const row of this.#db.prepare('SELECT s.id,s.project_id,s.kind,s.name,s.prompt_json,t.business_type FROM task_steps s JOIN tasks t ON t.id=s.task_id AND t.project_id=s.project_id').all()) {
            const { prompt, http } = splitLegacyPrompt(JSON.parse(row.prompt_json));
            const reviewer = row.kind === 'review' ? (String(row.name || '').includes('AI审核') ? 'ai' : 'program') : null;
            update.run(stepExecutor({ business_type: row.business_type }, row.kind, reviewer), JSON.stringify(prompt), JSON.stringify(http), row.id, row.project_id);
          }
          this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (22,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=22; COMMIT');
          version = 22;
        } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
      }
      if (version === 22) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          this.#db.exec('CREATE INDEX IF NOT EXISTS task_node_latest ON tasks(project_id,business_type,target_id,queue_order DESC)');
          for (const row of this.#db.prepare('SELECT id,data_json FROM projects').all()) {
            const project = JSON.parse(row.data_json);
            project.latest_tasks = {}; project.latest_groups = {};
            const tasks = this.#db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY queue_order').all(row.id);
            const groups = new Map(this.#db.prepare('SELECT * FROM task_groups WHERE project_id=?').all(row.id).map(g => [g.id, g]));
            for (const task of tasks) {
              project.latest_tasks[`${task.business_type}:${task.target_id}`] = task.id;
              const group = groups.get(task.group_id);
              if (group?.group_type === 'episode-film') {
                project.latest_groups[`episode-film:${group.episode_id}`] = group.id;
                const shots = JSON.parse(group.shot_ids_json);
                if (shots.length === 1) project.latest_groups[`shot-film:${shots[0]}`] = group.id;
              }
              if (task.business_type === 'costume-image' && group) project.latest_groups['costume-image'] = group.id;
            }
            validateProject(project);
            this.#db.prepare('UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(project), row.id);
          }
          this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (23,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=23; COMMIT'); version = 23;
        } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
      }
      if (version === 23) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          this.#db.exec(`CREATE TABLE task_steps_v24 (
            id TEXT PRIMARY KEY NOT NULL,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            task_id TEXT NOT NULL,
            seq INTEGER NOT NULL CHECK(seq >= 1),
            name TEXT,
            kind TEXT NOT NULL CHECK(kind IN ('precheck','generate','review','revise','manual_edit','override','impact','download','apply')),
            round INTEGER NOT NULL CHECK(round BETWEEN 0 AND 2),
            step_status TEXT NOT NULL CHECK(step_status IN ('ready','running','done','rejected','failed','skipped','cancelled','superseded')),
            executor TEXT NOT NULL CHECK(executor IN ('ai','program')),
            prompt_json TEXT NOT NULL CHECK(json_valid(prompt_json)),
            http_json TEXT NOT NULL CHECK(json_valid(http_json)),
            result_json TEXT NOT NULL CHECK(json_valid(result_json)),
            error_reason TEXT NOT NULL,
            started_at TEXT,
            ended_at TEXT,
            position INTEGER NOT NULL,
            UNIQUE(task_id,seq),
            FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id) DEFERRABLE INITIALLY DEFERRED
          ) STRICT`);
          const stepColumns = columns.task_steps.join(',');
          this.#db.exec(`INSERT INTO task_steps_v24 (${stepColumns}) SELECT ${stepColumns} FROM task_steps`);
          this.#db.exec('DROP TABLE task_steps');
          this.#db.exec('ALTER TABLE task_steps_v24 RENAME TO task_steps');
          this.#db.exec('CREATE INDEX IF NOT EXISTS steps_project ON task_steps(project_id)');
          for (const row of this.#db.prepare('SELECT id,data_json FROM projects').all()) {
            const project = JSON.parse(row.data_json);
            let changed = false;
            for (const episode of project.episodes || [])
              for (const shot of episode.shot_list?.shots || [])
                if (shot.video && typeof shot.video.server_address !== 'string') {
                  shot.video.server_address = '';
                  changed = true;
                }
            if (changed) {
              validateProject(project);
              this.#db.prepare('UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(project), row.id);
            }
          }
          this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (24,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=24; COMMIT'); version = 24;
        } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
      }
      if (version === 24) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of this.#db.prepare('SELECT id,data_json FROM projects').all()) {
            const project=JSON.parse(row.data_json);
            const before=project.aspect_ratio;
            migrateAspectRatio(project);
            validateProject(project);
            if (before!==project.aspect_ratio)
              this.#db.prepare('UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(project),row.id);
          }
          this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (25,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=25; COMMIT'); version=25;
        } catch(error) { this.#db.exec('ROLLBACK'); throw error; }
      }
      if (version === 25) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of this.#db.prepare('SELECT id,data_json FROM projects').all()) {
            const project = migrateSupplementRules(JSON.parse(row.data_json));
            validateCurrentProject(initializeScriptAdaptation(project));
            this.#db.prepare('UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(project),row.id);
          }
          this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (26,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=26; COMMIT'); version=26;
        } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
      }
      if (version === 26) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of this.#db.prepare('SELECT id,data_json FROM projects').all()) {
            const project=JSON.parse(row.data_json),missing=!Object.hasOwn(project.script,'adaptation_rules');
            initializeScriptAdaptation(project);
            validateCurrentProject(project);
            if (missing) this.#db.prepare('UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(project),row.id);
          }
          this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (27,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=27; COMMIT');version=27;
        } catch(error) {this.#db.exec('ROLLBACK');throw error;}
      }
      if (version === 27) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          // 从当前建表定义取步骤结构，约束扩至3；JSON记录不解析、不重写。
          const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
          const definition = schema.match(/CREATE TABLE task_steps \([\s\S]*?\n\) STRICT;/)?.[0];
          if (!definition) throw new Error('缺少步骤表定义');
          this.#db.exec(definition.replace('CREATE TABLE task_steps (', 'CREATE TABLE task_steps_v28 ('));
          const fields = columns.task_steps.join(',');
          this.#db.exec(`INSERT INTO task_steps_v28 (${fields}) SELECT ${fields} FROM task_steps;
            DROP TABLE task_steps;
            ALTER TABLE task_steps_v28 RENAME TO task_steps;
            CREATE INDEX steps_project ON task_steps(project_id);`);
          if (this.#db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('步骤迁移外键检查失败');
          this.#db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES (28,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
          this.#db.exec('PRAGMA user_version=28; COMMIT'); version=28;
        } catch(error) { this.#db.exec('ROLLBACK'); throw error; }
      }
      if (version !== 28) throw new Error(`不支持的数据库版本：${version}`);
      for (const [table, fields] of Object.entries(columns)) {
        // 已有行不改 position（保持写入顺序）；步骤的提示词与 HTTP 只经 writeStepRecord 写入。
        this.#upserts.set(table, this.#db.prepare(`INSERT INTO ${table} (${fields}) VALUES (${fields.map(() => "?")}) ON CONFLICT(id) DO UPDATE SET ${fields.filter(f => !["id", "position", "prompt_json", "http_json"].includes(f)).map(f => `${f}=excluded.${f}`).join(",")}`));
      }
    } catch (error) { this.#db.close(); throw error; }
  }
  list() { return this.#db.prepare("SELECT id FROM projects ORDER BY rowid").all().map(r => r.id); }
  // 工作快照只含排队中或运行中任务所在的任务组（整组），步骤不含提示词与 HTTP；
  // 已结束的历史只在数据库，经下方查询方法按 ID 读取。
  read(id) {
    // 所有表在同一个读事务内，跨连接也不会拼出不同版本的快照。
    this.#db.exec("BEGIN");
    try {
      const p = this.#db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      if (!p) return null;
      const rows = (table) => this.#db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY position`).all(id);
      const live = `SELECT group_id FROM tasks WHERE project_id=? AND task_status IN ('queued','running')`;
      return {
        project: JSON.parse(p.data_json),
        groups: this.#db.prepare(`SELECT * FROM task_groups WHERE project_id=? AND id IN (${live}) ORDER BY position`).all(id, id).map(r => decode(r)),
        tasks: this.#db.prepare(`SELECT * FROM tasks WHERE project_id=? AND group_id IN (${live}) ORDER BY position`).all(id, id).map(r => decode(r)),
        steps: this.#db.prepare(`SELECT ${stepState},prompt_json<>'null' AS has_prompt,json_array_length(http_json)>0 AS has_http FROM task_steps WHERE project_id=? AND task_id IN (SELECT id FROM tasks WHERE project_id=? AND group_id IN (${live})) ORDER BY position`).all(id, id, id).map(r => decode(r, true)),
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
        let nextPosition = this.#db.prepare(`SELECT COALESCE(MAX(position),-1)+1 AS next FROM ${table} WHERE project_id=?`).get(id).next;
        if (table === 'tasks') {
          // 动态插入编排先腾开被移动任务的位置，避免逐行 upsert 撞组内唯一序号。
          const moved = snapshot.tasks.filter(row => old.has(row.id) && old.get(row.id).row.group_seq !== row.group_seq);
          const offset = Math.max(0, ...snapshot.tasks.map(row => row.group_seq), ...(before?.tasks || []).map(row => row.group_seq)) + 1;
          for (const row of moved) this.#db.prepare('UPDATE tasks SET group_seq=group_seq+? WHERE id=?').run(offset, row.id);
        }
        snapshot[key].forEach((row) => {
          const previous = old.get(row.id);
          if (previous && JSON.stringify(previous.row) === JSON.stringify(row)) return;
          // 新行接在已有最大位置之后；已有行的位置不变（upsert 不更新 position）。
          const record = { prompt: null, http: [], ...row, project_id: id, position: previous ? 0 : nextPosition++ };
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
  // —— 历史查询（按 ID 读取已结束及全部任务；步骤记录仅在显式要求时读取）——
  group(projectId, groupId, { records = false } = {}) {
    const group = this.#db.prepare("SELECT * FROM task_groups WHERE project_id=? AND id=?").get(projectId, groupId);
    if (!group) return null;
    const tasks = this.#db.prepare("SELECT * FROM tasks WHERE project_id=? AND group_id=? ORDER BY group_seq").all(projectId, groupId).map(r => decode(r));
    // 摘要只带“是否有记录”的标记，不读取记录内容。
    const columns = records ? `${stepState},prompt_json,http_json` : `${stepState},prompt_json<>'null' AS has_prompt,json_array_length(http_json)>0 AS has_http`;
    const steps = tasks.length ? this.#db.prepare(`SELECT ${columns} FROM task_steps WHERE project_id=? AND task_id IN (${tasks.map(() => "?").join(",")}) ORDER BY seq`)
      .all(projectId, ...tasks.map(t => t.id)).map(r => decode(r, true)) : [];
    const order = new Map(tasks.map((task, i) => [task.id, i]));
    steps.sort((a, b) => order.get(a.task_id) - order.get(b.task_id) || a.seq - b.seq);
    return { group: decode(group), tasks, steps };
  }
  task(projectId, taskId) {
    const row = this.#db.prepare("SELECT * FROM tasks WHERE project_id=? AND id=?").get(projectId, taskId);
    return row ? decode(row) : null;
  }
  // 某节点（或非节点业务）最近一次任务，可排除指定任务。
  latestTask(projectId, business, targetId, excludeId = "", status = "") {
    const row = this.#db.prepare("SELECT * FROM tasks WHERE project_id=? AND business_type=? AND target_id=? AND id<>? AND (?='' OR task_status=?) ORDER BY queue_order DESC LIMIT 1")
      .get(projectId, business, targetId, excludeId, status, status);
    return row ? decode(row) : null;
  }
  stepsOf(projectId, taskId, { records = false } = {}) {
    const columns = records ? `${stepState},prompt_json,http_json` : `${stepState},prompt_json<>'null' AS has_prompt,json_array_length(http_json)>0 AS has_http`;
    return this.#db.prepare(`SELECT ${columns} FROM task_steps WHERE project_id=? AND task_id=? ORDER BY seq`).all(projectId, taskId).map(r => decode(r, true));
  }
  maxQueueOrder(projectId) {
    return this.#db.prepare("SELECT COALESCE(MAX(queue_order),0) AS max FROM tasks WHERE project_id=?").get(projectId).max;
  }
  // 任务历史列表：只读任务组与任务表，不读步骤。
  historyRows(projectId) {
    const groups = this.#db.prepare("SELECT * FROM task_groups WHERE project_id=? ORDER BY position").all(projectId).map(r => decode(r));
    const tasks = this.#db.prepare("SELECT * FROM tasks WHERE project_id=? ORDER BY group_seq").all(projectId).map(r => decode(r));
    return { groups, tasks };
  }
  // 运行中步骤的提示词与 HTTP 直接写入对应行，不经项目快照提交。
  writeStepRecord(projectId, stepId, { prompt, http }) {
    const sets = [], values = [];
    if (prompt !== undefined) { sets.push("prompt_json=?"); values.push(JSON.stringify(prompt)); }
    if (http !== undefined) { sets.push("http_json=?"); values.push(JSON.stringify(http)); }
    if (!sets.length) return false;
    return this.#db.prepare(`UPDATE task_steps SET ${sets.join(",")} WHERE project_id=? AND id=? AND step_status='running' AND task_id IN (SELECT id FROM tasks WHERE project_id=? AND task_status='running')`).run(...values, projectId, stepId, projectId).changes > 0;
  }
  // 全部任务组、任务与步骤状态（不含记录），仅供 ProjectModel.readAll 诊断使用。
  allRows(projectId) {
    return {
      groups: this.#db.prepare("SELECT * FROM task_groups WHERE project_id=? ORDER BY position").all(projectId).map(r => decode(r)),
      tasks: this.#db.prepare("SELECT * FROM tasks WHERE project_id=? ORDER BY position").all(projectId).map(r => decode(r)),
      steps: this.#db.prepare(`SELECT ${stepState},prompt_json<>'null' AS has_prompt,json_array_length(http_json)>0 AS has_http FROM task_steps WHERE project_id=? ORDER BY position`).all(projectId).map(r => decode(r, true)),
    };
  }
  // 已存在于数据库的 ID（用于拒绝把已移出工作快照的历史以同 ID 重新写入）。
  existingIds(projectId, table, ids) {
    if (!ids.length || !["tasks", "task_steps", "task_groups"].includes(table)) return [];
    return this.#db.prepare(`SELECT id FROM ${table} WHERE project_id=? AND id IN (${ids.map(() => "?").join(",")})`).all(projectId, ...ids).map(r => r.id);
  }
  stepRecords(projectId, stepIds) {
    if (!stepIds.length) return [];
    return this.#db.prepare(`SELECT id,prompt_json,http_json FROM task_steps WHERE project_id=? AND id IN (${stepIds.map(() => "?").join(",")})`)
      .all(projectId, ...stepIds).map(r => ({ id: r.id, prompt: JSON.parse(r.prompt_json), http: JSON.parse(r.http_json) }));
  }
  remove(id, revision) {
    const result = this.#db.prepare("DELETE FROM projects WHERE id=? AND revision=?").run(id, revision);
    if (!result.changes) throw conflict();
  }
  close() { this.#db.close(); }
}
