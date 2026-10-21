import { randomUUID } from 'node:crypto';
import { recordTitle } from './record-title.js';

// 一次 HTTP 请求一行。进行中的请求留在本类内存，同时插入本地；
// 返回合并后更新同一行。多次返回先留在内存，全部结束才更新本地。

const httpRecordsSchema = `
CREATE TABLE IF NOT EXISTS http_records (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  returned_at TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  headers_json TEXT NOT NULL CHECK(json_valid(headers_json)),
  params_json TEXT NOT NULL CHECK(json_valid(params_json)),
  status INTEGER CHECK(status IS NULL OR status BETWEEN 100 AND 599),
  ok INTEGER CHECK(ok IS NULL OR ok IN (0,1)),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  error TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS http_records_started ON http_records(started_at, id);
`;

const summary = 'id,title,started_at,returned_at,method,path,status,ok,error';

function reject(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function bounds({ offset = 0, limit = 50 }) {
  if (!Number.isInteger(offset) || offset < 0) throw reject('offset 无效');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw reject('limit 无效');
  return { offset, limit };
}

function json(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function responseOf(transfer) {
  if (transfer.bytes !== undefined) return { bytes: transfer.bytes };
  return transfer.body === undefined ? null : transfer.body;
}

function returned(transfer) {
  return ['ok', 'status', 'error', 'body', 'bytes'].some(key => Object.hasOwn(transfer, key));
}

function requestOf(transfer) {
  const request = transfer.request || {};
  const method = transfer.method || request.method;
  const path = transfer.path || request.path;
  if (typeof method !== 'string' || !method || typeof path !== 'string' || !path) throw reject('请求缺少方式或路径');
  return {
    id: typeof transfer.id === 'string' && transfer.id ? transfer.id : randomUUID(),
    started_at: new Date().toISOString(),
    returned_at: null,
    method, path,
    title: recordTitle({ title: transfer.title ?? request.title, method, path, params: request.body }),
    headers: request.headers && typeof request.headers === 'object' ? request.headers : {},
    params: request.body === undefined ? null : request.body,
    status: null,
    ok: null,
    response: null,
    error: '',
    written: false,
  };
}

function flag(row) {
  return { ...row, ok: row.ok === null ? null : Boolean(row.ok) };
}

// 记录、进行中的内存副本、入库和查询都从这里进入。调用方传入自己的 node:sqlite 连接。
export class HttpRecords {
  #pending = new WeakMap();
  #active = new Map();
  #insert;
  #update;
  #remove;
  #list;
  #read;

  constructor(db) {
    if (!db || typeof db.prepare !== 'function') throw reject('缺少数据库');
    db.exec(httpRecordsSchema);
    if (!db.prepare('PRAGMA table_info(http_records)').all().some(column => column.name === 'title'))
      db.exec("ALTER TABLE http_records ADD COLUMN title TEXT NOT NULL DEFAULT ''");
    // 旧表只补标题，不重建请求正文或改变来源；重复初始化可继续未完成的回填。
    const fillTitle = db.prepare('UPDATE http_records SET title=? WHERE id=?');
    for (const row of db.prepare("SELECT id,method,path,params_json,response_json,ok FROM http_records WHERE title='' OR (method='MODEL' AND title='会话回复') ").all())
      fillTitle.run(recordTitle({ ...row, params: JSON.parse(row.params_json), response: row.ok === 1 ? JSON.parse(row.response_json) : undefined }), row.id);
    this.#insert = db.prepare(`INSERT INTO http_records
      (id,title,started_at,returned_at,method,path,headers_json,params_json,status,ok,response_json,error)
      VALUES (?,?,?,NULL,?,?,?,?,NULL,NULL,'null','')`);
    this.#update = db.prepare(`UPDATE http_records SET title=?,returned_at=?,status=?,ok=?,response_json=?,error=? WHERE id=?`);
    this.#remove = db.prepare('DELETE FROM http_records WHERE id=?');
    this.#list = db.prepare(`SELECT ${summary} FROM http_records ORDER BY started_at, id LIMIT ? OFFSET ?`);
    this.#read = db.prepare(`SELECT id,title,started_at,returned_at,method,path,headers_json,params_json,status,ok,response_json,error
      FROM http_records WHERE id=?`);
  }

  // 可直接作为 requestData 的 record 回调。options.partial 表示还有后续返回；options.drop 删除该行。
  record = async (transfer, options) => {
    if (!transfer || typeof transfer !== 'object') throw reject('缺少请求');
    const existing = this.#pending.get(transfer);
    if (options?.drop) {
      if (existing && !existing.written) this.#forget(transfer, existing);
      return;
    }
    const current = existing || this.#open(transfer);
    if (current.written || !returned(transfer)) return;
    if (typeof transfer.title === 'string' && transfer.title.trim()) current.title = transfer.title.trim();
    current.status = Number.isInteger(transfer.status) ? transfer.status : null;
    current.ok = transfer.ok === true;
    current.response = responseOf(transfer);
    current.error = typeof transfer.error === 'string' ? transfer.error : '';
    if (options?.partial) return;
    current.returned_at = new Date().toISOString();
    current.written = true;
    this.#update.run(current.title, current.returned_at, current.status, current.ok ? 1 : 0, json(current.response), current.error, current.id);
    this.#pending.delete(transfer);
    this.#active.delete(current.id);
  };

  // 仍在等待返回的请求。已结束的只留在数据库。
  active() {
    return [...this.#active.values()].map(({ written, ...row }) => ({ ...row }));
  }

  list(filter = {}) {
    const { offset, limit } = bounds(filter);
    return this.#list.all(limit, offset).map(flag);
  }

  read(id) {
    if (typeof id !== 'string' || !id) throw reject('缺少记录');
    const row = this.#read.get(id);
    if (!row) return null;
    const { headers_json, params_json, response_json, ...rest } = row;
    return { ...flag(rest), headers: JSON.parse(headers_json), params: JSON.parse(params_json), response: JSON.parse(response_json) };
  }

  #open(transfer) {
    const created = requestOf(transfer);
    this.#insert.run(created.id, created.title, created.started_at, created.method, created.path, json(created.headers), json(created.params));
    this.#pending.set(transfer, created);
    this.#active.set(created.id, created);
    return created;
  }

  #forget(transfer, row) {
    this.#remove.run(row.id);
    this.#active.delete(row.id);
    this.#pending.delete(transfer);
  }
}
