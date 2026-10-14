import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRepository } from '../server/data/model-repository.js';
import { emptyCharacterModel, primaryCostumeImage } from '../shared/models/character_model.js';
import { emptyCostumeModel } from '../shared/models/costume_model.js';
import { emptyCostumeImageModel } from '../shared/models/costume_image_model.js';
import { projectFixture } from './fixtures/project.js';

for (const malformed of [false, true]) test(`v6→v7 默认图与历史原图保留，${malformed ? '非法数据回滚' : '备份且仅迁移一次'}`, async () => {
 const root = await mkdtemp(join(tmpdir(), 'meiji-portraits-')), path = join(root, 'meiji.sqlite');
 let repo;
 try {
  repo = new ModelRepository(root);
  const p = projectFixture(), c = emptyCharacterModel({ name: '甲', number: 'C01' });
  const costume = emptyCostumeModel({ name: '常服', number: 'C01-01' });
  c.costumes = [costume];
  c.costume_images = [{ ...emptyCostumeImageModel(costume.id), address: 'costume.png', node_state: { status: 'generated', reason: '', dependency_hash: 'a'.repeat(64) } }];
  p.character_library.characters = [c];
  await repo.create(p); await repo.close(); repo = null;
  c.character_image = { address: 'old-role.png', node_state: { status: 'generated', reason: '', dependency_hash: 'b'.repeat(64) } };
  if (malformed) c.name = 123;
  const old = JSON.stringify(p), db = new DatabaseSync(path);
  db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(old, p.id);
  db.exec('DELETE FROM schema_migrations WHERE version>=7; PRAGMA user_version=6'); db.close();
  repo = new ModelRepository(root);
  if (malformed) {
   await assert.rejects(repo.open(p.id), /name/);
   repo = null;
   const check = new DatabaseSync(path);
   assert.equal(check.prepare('PRAGMA user_version').get().user_version, 6);
   assert.equal(check.prepare('SELECT data_json FROM projects').get().data_json, old); check.close();
  } else {
   const snapshot = (await repo.open(p.id)).read(), saved = snapshot.project.character_library.characters[0];
   assert.equal(Object.hasOwn(saved, 'character_image'), false);
   assert.equal(primaryCostumeImage(saved).address, 'costume.png');
   assert.equal(primaryCostumeImage(saved).node_state.status, 'expired');
   assert.equal(primaryCostumeImage(saved).node_state.dependency_hash, 'a'.repeat(64));
   assert.equal(saved.costume_images.find(image => !image.costume_id).address, 'old-role.png');
   await repo.close(); repo = new ModelRepository(root);
   assert.equal((await repo.open(p.id)).read().runtime.revision, snapshot.runtime.revision);
  }
  const backups = (await readdir(root)).filter(name => name.includes('before-v7'));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(root, backups[0]));
  assert.equal(backup.prepare('SELECT data_json FROM projects').get().data_json, old); backup.close();
 } finally { await repo?.close(); await rm(root, { recursive: true, force: true }); }
});
