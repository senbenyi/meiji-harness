import { DatabaseSync } from 'node:sqlite';
import { TaskStore } from './index.js';
import { text } from '../models/index.js';

// scope 是存储隔离键，不写进公共 Model，更不解析业务 metadata。
export class SQLiteTaskStore extends TaskStore {
  #owned;
  constructor(path = ':memory:', { database } = {}) {
    super();
    this.database = database || new DatabaseSync(path);
    this.#owned = !database;
    this.database.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS agent_task_groups(scope TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS agent_tasks(scope TEXT NOT NULL,id TEXT NOT NULL,group_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,id),FOREIGN KEY(scope,group_id) REFERENCES agent_task_groups(scope,id));
      CREATE TABLE IF NOT EXISTS agent_task_steps(scope TEXT NOT NULL,id TEXT NOT NULL,task_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,id),FOREIGN KEY(scope,task_id) REFERENCES agent_tasks(scope,id));`);
  }
  atomic(run) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  read(scope, { steps = true } = {}) {
    text(scope, 'scope', true);
    const rows = table => this.database.prepare(`SELECT data FROM ${table} WHERE scope=? ORDER BY rowid`).all(scope).map(row => JSON.parse(row.data));
    return { groups: rows('agent_task_groups'), tasks: rows('agent_tasks'), steps: steps ? rows('agent_task_steps') : [] };
  }
  write(scope, data) {
    for (const [key, table, parent] of [['groups', 'agent_task_groups', null], ['tasks', 'agent_tasks', 'group_id'], ['steps', 'agent_task_steps', 'task_id']]) {
      const statement = this.database.prepare(parent
        ? `INSERT INTO ${table}(scope,id,${parent},data) VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET data=excluded.data`
        : `INSERT INTO ${table}(scope,id,data) VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET data=excluded.data`);
      for (const row of data[key]) statement.run(...[scope, row.id, ...(parent ? [row[parent]] : []), JSON.stringify(row)]);
    }
  }
  scopes() { return this.database.prepare('SELECT DISTINCT scope FROM agent_task_groups').all().map(row => row.scope); }
  close() { if (this.#owned) this.database.close(); }
}
