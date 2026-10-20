import { DatabaseSync } from 'node:sqlite';
import { TaskStore, emptySnapshot, snapshotChanges, validatePagination } from './index.js';
import { text, groupSummary } from '../models/index.js';

const tables = [['groups', 'agent_task_groups', null], ['tasks', 'agent_tasks', 'group_id'], ['steps', 'agent_task_steps', 'task_id']];

// scope 是存储隔离键，不写进公共 Model，更不解析业务 metadata。
export class SQLiteTaskStore extends TaskStore {
  #owned;
  #statements = new Map();
  constructor(path = ':memory:', { database } = {}) {
    super();
    this.database = database || new DatabaseSync(path);
    this.#owned = !database;
    this.database.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS agent_task_groups(scope TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS agent_tasks(scope TEXT NOT NULL,id TEXT NOT NULL,group_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,id),FOREIGN KEY(scope,group_id) REFERENCES agent_task_groups(scope,id));
      CREATE TABLE IF NOT EXISTS agent_task_steps(scope TEXT NOT NULL,id TEXT NOT NULL,task_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,id),FOREIGN KEY(scope,task_id) REFERENCES agent_tasks(scope,id));
      CREATE INDEX IF NOT EXISTS agent_tasks_group ON agent_tasks(scope,group_id);
      CREATE INDEX IF NOT EXISTS agent_tasks_group_order ON agent_tasks(scope,group_id,json_extract(data,'$.queue_order'));
      CREATE INDEX IF NOT EXISTS agent_tasks_group_status ON agent_tasks(scope,group_id,json_extract(data,'$.task_status'),json_extract(data,'$.group_seq'));
      CREATE INDEX IF NOT EXISTS agent_steps_task ON agent_task_steps(scope,task_id);
      CREATE INDEX IF NOT EXISTS agent_tasks_status ON agent_tasks(scope,json_extract(data,'$.task_status'),json_extract(data,'$.queue_order'));
      CREATE INDEX IF NOT EXISTS agent_tasks_type ON agent_tasks(scope,group_id,json_extract(data,'$.node_type'));
      CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_order ON agent_tasks(scope,json_extract(data,'$.queue_order'));
      CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_position ON agent_tasks(scope,group_id,json_extract(data,'$.group_seq'));
      CREATE UNIQUE INDEX IF NOT EXISTS agent_steps_position ON agent_task_steps(scope,task_id,json_extract(data,'$.seq'));
      CREATE UNIQUE INDEX IF NOT EXISTS agent_one_running_task ON agent_tasks(scope) WHERE json_extract(data,'$.task_status')='running';`);
  }
  #statement(sql) {
    if (!this.#statements.has(sql)) this.#statements.set(sql, this.database.prepare(sql));
    return this.#statements.get(sql);
  }
  atomic(run) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  read(scope, { steps = true, groupId, taskId, groupIds, activeOnly = false, append = false } = {}) {
    text(scope, 'scope', true);
    if (append) return emptySnapshot();
    const params = [scope], where = ['g.scope=?'];
    if (taskId) groupId = this.taskGroupId(scope, taskId) || '';
    if (groupId !== undefined) { where.push('g.id=?'); params.push(groupId); }
    if (groupIds) {
      where.push(groupIds.length ? `g.id IN (${groupIds.map(() => '?').join(',')})` : '0');
      params.push(...groupIds);
    }
    if (activeOnly) where.push(`g.id IN (SELECT group_id FROM agent_tasks WHERE scope=g.scope AND json_extract(data,'$.task_status') IN ('queued','running'))`);
    const groupQuery = `SELECT g.id FROM agent_task_groups g WHERE ${where.join(' AND ')}`;
    // 仅解析选中的组及其记录；历史HTTP正文不会进入执行快照。
    const groups = this.#statement(`SELECT g.data FROM agent_task_groups g WHERE ${where.join(' AND ')} ORDER BY g.rowid`).all(...params).map(row => JSON.parse(row.data));
    if (!groups.length) return emptySnapshot();
    const taskQuery = `SELECT id FROM agent_tasks WHERE scope=? AND group_id IN (${groupQuery})`;
    const tasks = this.#statement(`SELECT data FROM agent_tasks WHERE scope=? AND group_id IN (${groupQuery}) ORDER BY rowid`).all(scope, ...params).map(row => JSON.parse(row.data));
    const records = steps ? this.#statement(`SELECT data FROM agent_task_steps WHERE scope=? AND task_id IN (${taskQuery}) ORDER BY rowid`).all(scope, scope, ...params).map(row => JSON.parse(row.data)) : [];
    return { groups, tasks, steps: records };
  }
  write(scope, data, previous = this.read(scope)) {
    const delta = snapshotChanges(data, previous);
    // 先释放旧running行，再领取新行，避免同事务中临时撞上唯一约束。
    delta.tasks.sort((a, b) => Number(a.task_status === 'running') - Number(b.task_status === 'running'));
    for (const [key, table, parent] of tables) {
      const prior = new Set(previous[key].map(row => row.id));
      for (const row of delta[key]) {
        const body = JSON.stringify(row);
        if (prior.has(row.id)) this.#statement(`UPDATE ${table} SET data=? WHERE scope=? AND id=?`).run(body, scope, row.id);
        else this.#statement(parent ? `INSERT INTO ${table}(scope,id,${parent},data) VALUES(?,?,?,?)`
          : `INSERT INTO ${table}(scope,id,data) VALUES(?,?,?)`).run(scope, row.id, ...(parent ? [row[parent]] : []), body);
      }
    }
  }
  hasGroup(scope, id) {
    text(scope, 'scope', true);
    return Boolean(this.#statement('SELECT 1 FROM agent_task_groups WHERE scope=? AND id=?').get(scope, id));
  }
  taskGroupId(scope, id) {
    text(scope, 'scope', true);
    return this.#statement('SELECT group_id FROM agent_tasks WHERE scope=? AND id=?').get(scope, id)?.group_id || null;
  }
  queueTail(scope) {
    text(scope, 'scope', true);
    return this.#statement("SELECT COALESCE(MAX(json_extract(data,'$.queue_order')),0) AS n FROM agent_tasks WHERE scope=?").get(scope).n;
  }
  history(scope, { status = '', node_type = '', offset = 0, limit = 50 } = {}) {
    text(scope, 'scope', true); validatePagination(offset, limit);
    // 与groupSummary一致：按组内顺序选首个失败/拒绝/取消，再考虑running/queued。
    const query = `WITH summaries AS (
      SELECT g.id,g.rowid AS ordinal,
        COALESCE((SELECT json_extract(t.data,'$.task_status') FROM agent_tasks t WHERE t.scope=g.scope AND t.group_id=g.id
          AND json_extract(t.data,'$.task_status') IN ('failed','rejected','cancelled') ORDER BY json_extract(t.data,'$.group_seq') LIMIT 1),
          CASE WHEN EXISTS(SELECT 1 FROM agent_tasks t WHERE t.scope=g.scope AND t.group_id=g.id AND json_extract(t.data,'$.task_status')='running') THEN 'running'
            WHEN EXISTS(SELECT 1 FROM agent_tasks t WHERE t.scope=g.scope AND t.group_id=g.id AND json_extract(t.data,'$.task_status')='queued') THEN 'queued'
            WHEN EXISTS(SELECT 1 FROM agent_tasks t WHERE t.scope=g.scope AND t.group_id=g.id) THEN 'completed' ELSE 'queued' END) AS status,
        COALESCE((SELECT MAX(json_extract(t.data,'$.queue_order')) FROM agent_tasks t WHERE t.scope=g.scope AND t.group_id=g.id),0) AS queue_order
      FROM agent_task_groups g WHERE g.scope=? AND (?='' OR EXISTS(
        SELECT 1 FROM agent_tasks t WHERE t.scope=g.scope AND t.group_id=g.id AND json_extract(t.data,'$.node_type')=?))
    )`;
    const params = [scope, node_type, node_type, status, status];
    const total = this.#statement(`${query} SELECT COUNT(*) AS n FROM summaries WHERE (?='' OR status=?)`).get(...params).n;
    const ids = this.#statement(`${query} SELECT id FROM summaries WHERE (?='' OR status=?) ORDER BY queue_order DESC,ordinal ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(row => row.id);
    const page = this.read(scope, { groupIds: ids, steps: false });
    const groups = new Map(page.groups.map(group => [group.id, group]));
    const members = new Map(ids.map(id => [id, []]));
    for (const task of page.tasks) members.get(task.group_id).push(task);
    return { groups: ids.map(id => groupSummary(groups.get(id), members.get(id))), total, offset, limit };
  }
  scopes() { return this.#statement('SELECT DISTINCT scope FROM agent_task_groups').all().map(row => row.scope); }
  close() { if (this.#owned) this.database.close(); }
}
