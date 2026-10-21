import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { HttpRecords } from '../src/records.js';

const count = db => db.prepare('SELECT count(*) n FROM http_records').get().n;

test('发出时写入内存和本地，返回后更新同一条', async () => {
  const db = new DatabaseSync(':memory:');
  new HttpRecords(db);
  const records = new HttpRecords(db);
  const transfer = {
    id: 'req-1', method: 'POST', path: '/v1/chat/completions',
    request: { method: 'POST', path: '/v1/chat/completions', headers: { Authorization: 'Bearer hidden' }, body: { input: '资料' } },
  };
  await records.record(transfer);
  assert.equal(count(db), 1);
  assert.deepEqual(records.active().map(row => row.id), ['req-1']);
  const pending = records.read('req-1');
  assert.equal(pending.returned_at, null);
  assert.equal(pending.status, null);
  assert.equal(pending.ok, null);
  assert.equal(pending.response, null);
  assert.deepEqual(pending.params, { input: '资料' });
  await records.record(Object.assign(transfer, { ok: true, status: 200, body: { answer: '完成' } }));
  assert.equal(count(db), 1);
  assert.deepEqual(records.active(), []);
  const row = records.read('req-1');
  assert.equal(row.method, 'POST');
  assert.equal(row.path, '/v1/chat/completions');
  assert.deepEqual(row.headers, { Authorization: 'Bearer hidden' });
  assert.deepEqual(row.params, { input: '资料' });
  assert.equal(row.status, 200);
  assert.equal(row.ok, true);
  assert.deepEqual(row.response, { answer: '完成' });
  assert.equal(row.error, '');
  assert.ok(row.started_at <= row.returned_at);
  db.close();
});

test('多次返回先留在内存，最后一次才更新，丢弃的请求删除本地行', async () => {
  const db = new DatabaseSync(':memory:');
  const records = new HttpRecords(db);
  const polled = { method: 'GET', path: '/tasks/1', request: { headers: {}, body: null } };
  await records.record(polled);
  const polledId = records.list()[0].id;
  await records.record(Object.assign(polled, { ok: true, status: 200, body: { status: 'running' } }), { partial: true });
  assert.equal(count(db), 1);
  assert.equal(records.read(polledId).response, null);
  assert.equal(records.active()[0].response.status, 'running');
  await records.record(Object.assign(polled, { body: { status: 'succeeded', url: 'https://cdn.example/v.mp4' } }));
  assert.equal(count(db), 1);
  assert.deepEqual(records.active(), []);
  assert.equal(records.read(polledId).response.status, 'succeeded');

  const dropped = { method: 'GET', path: '/tasks/2', request: { headers: {} } };
  await records.record(dropped);
  await records.record(Object.assign(dropped, { ok: true, status: 200, body: { status: 'running' } }), { drop: true });
  assert.equal(count(db), 1);
  assert.deepEqual(records.active(), []);

  const failed = { method: 'POST', path: '/v1/images', request: { headers: {}, body: { prompt: '海报' } } };
  await records.record(failed);
  await records.record(Object.assign(failed, { ok: false, status: null, error: '超时' }));
  const byPath = Object.fromEntries(records.list().map(row => [row.path, row]));
  assert.equal(byPath['/tasks/1'].ok, true);
  assert.equal(byPath['/tasks/1'].error, '');
  assert.equal(byPath['/v1/images'].method, 'POST');
  assert.equal(byPath['/v1/images'].ok, false);
  assert.equal(byPath['/v1/images'].error, '超时');
  assert.equal(byPath['/v1/images'].status, null);
  db.close();
});

test('列表按开始时间分页，缺失记录返回空', async () => {
  const db = new DatabaseSync(':memory:');
  const records = new HttpRecords(db);
  await records.record({ id: 'a', method: 'GET', path: '/a', request: { headers: {} }, ok: true, status: 200, body: { n: 1 } });
  await records.record({ id: 'b', method: 'GET', path: '/b', request: { headers: {} }, ok: true, status: 204, body: '' });
  assert.equal(records.list({ limit: 1 })[0].id, 'a');
  assert.equal(records.list({ offset: 1 })[0].id, 'b');
  assert.equal(records.list()[0].headers, undefined);
  assert.equal(records.read('missing'), null);
  assert.throws(() => records.list({ limit: 0 }), /limit/);
  assert.throws(() => records.read(''), /缺少记录/);
  assert.throws(() => new HttpRecords(), /缺少数据库/);
  db.close();
});
