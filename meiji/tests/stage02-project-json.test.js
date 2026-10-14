import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ModelRepository } from '../server/data/model-repository.js';
import { projectFixture } from './fixtures/project.js';

async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), 'meiji-project-json-'));
  const repo = new ModelRepository(root), project = projectFixture();
  try { await work({ root, repo, project, file: join(root, project.id, 'project.json') }); }
  finally { await repo.close(); await rm(root, { recursive: true, force: true }); }
}
const read = async file => JSON.parse(await readFile(file, 'utf8'));

test('项目JSON：创建及串行更新任意项目字段，事件发布前同步完成', () => fixture(async ({ root, repo, project, file }) => {
  const model = await repo.create(project);
  assert.deepEqual(await read(file), model.read().project);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const events = [];
  repo.on('change', () => events.push(read(file)));
  await model.update('duration', {}, s => { s.project.episodes[0].duration_seconds = 288.5; s.project.episodes[0].episode_requirements = '新要求'; });
  assert.deepEqual(await events[0], model.read().project);
  await Promise.all([
    model.update('name', {}, s => { s.project.name = '新名称'; }),
    model.update('body', {}, s => { s.project.episodes[0].story_outline.segments[0].body = '新剧情'; }),
  ]);
  const json = await read(file), db = new DatabaseSync(join(root, 'meiji.sqlite'), { readOnly: true });
  try { assert.deepEqual(json, JSON.parse(db.prepare('SELECT data_json FROM projects WHERE id=?').get(project.id).data_json)); }
  finally { db.close(); }
  assert.deepEqual(json, model.read().project);
  assert.equal(json.tasks, undefined);
  assert.equal(json.episodes[0].duration_seconds, 288.5);
  assert.equal(json.name, '新名称');
  await assert.rejects(stat(file + '.tmp'), { code: 'ENOENT' });
}));

test('项目JSON：校验失败及数据库回滚不覆盖已保存JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-project-json-rollback-'));
  let fail = false;
  const repo = new ModelRepository(root, { checkpoint(point) { if (fail && point === 'after-project') throw Error('事务中断'); } });
  try {
    const p = projectFixture(), model = await repo.create(p), file = join(root, p.id, 'project.json'), before = await read(file);
    await assert.rejects(model.update('invalid', {}, s => { s.project.episodes[0].duration_seconds = -1; }));
    fail = true;
    await assert.rejects(model.update('rollback', {}, s => { s.project.name = '不应保存'; }), /事务中断/);
    assert.deepEqual(await read(file), before);
    assert.deepEqual(model.read().project, before);
  } finally { await repo.close(); await rm(root, { recursive: true, force: true }); }
});

test('项目JSON：写入失败明确警告，幂等重试修复且不重复业务提交', () => fixture(async ({ repo, project, file }) => {
  const model = await repo.create(project), old = await read(file);
  await mkdir(file + '.tmp');
  const result = await model.update('change', {}, s => { s.project.name = '数据库已更新'; });
  assert.equal(result.accepted, true);
  assert.match(result.storage_warning, /本地JSON同步失败/);
  assert.equal(model.read().project.name, '数据库已更新');
  assert.deepEqual(await read(file), old);
  await rm(file + '.tmp', { recursive: true });
  const retry = await model.update('change', {}, () => { throw Error('不应重复执行'); });
  assert.equal(retry.revision, result.revision);
  assert.equal(retry.storage_warning, undefined);
  assert.deepEqual(await read(file), model.read().project);
}));

test('项目JSON：重启补齐缺失、覆盖损坏或过期镜像，删除项目移除镜像', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-project-json-reopen-'));
  let repo = new ModelRepository(root);
  try {
    const a = projectFixture(), b = projectFixture();
    await repo.create(a); await repo.create(b); await repo.close();
    const aFile = join(root, a.id, 'project.json'), bFile = join(root, b.id, 'project.json');
    await rm(aFile); await writeFile(bFile, '{损坏JSON');
    repo = new ModelRepository(root);
    await repo.open(a.id);
    assert.deepEqual(await read(aFile), a);
    assert.deepEqual(await read(bFile), b);
    await repo.remove(a.id);
    await assert.rejects(stat(aFile), { code: 'ENOENT' });
  } finally { await repo.close(); await rm(root, { recursive: true, force: true }); }
});
