import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRepository } from '../server/data/model-repository.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';
import { emptyCostumeModel } from '../shared/models/costume_model.js';
import { projectFixture } from './fixtures/project.js';

for (const malformed of [false, true]) {
  test(`v5 角色数组迁移${malformed ? '非法成员整体回滚' : '备份、保留内容及身份、过期旧依赖且只执行一次'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'meiji-arrays-migration-'));
    const path = join(root, 'meiji.sqlite');
    try {
      const repo = new ModelRepository(root), p = projectFixture();
      const c = emptyCharacterModel({ name: '甲', number: 'C01', gender: '男' });
      c.costumes = [emptyCostumeModel({ name: '常服', number: 'C01-01' })];
      c.costume_images[0].address = 'keep.png';
      c.costume_images[0].node_state = { status: 'generated', reason: '', dependency_hash: 'a'.repeat(64) };
      p.character_library.characters = [c];
      await repo.create(p); await repo.close();
      c.signature_props = malformed ? [1] : '哨棒；竹篮';
      c.immutable_traits = '';
      c.costumes[0].props = ' 腰带 ';
      const old = JSON.stringify(p), db = new DatabaseSync(path);
      db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(old, p.id);
      db.exec('DELETE FROM schema_migrations WHERE version>=6; PRAGMA user_version=5'); db.close();
      const upgraded = new ModelRepository(root);
      if (malformed) {
        await assert.rejects(upgraded.open(p.id), /文本/);
        const check = new DatabaseSync(path);
        assert.equal(check.prepare('PRAGMA user_version').get().user_version, 5);
        assert.equal(check.prepare('SELECT data_json FROM projects').get().data_json, old);
        check.close();
      } else {
        const model = await upgraded.open(p.id), saved = model.read().project.character_library.characters[0];
        assert.equal(saved.id, c.id);
        assert.deepEqual(saved.signature_props, ['哨棒；竹篮']);
        assert.deepEqual(saved.immutable_traits, []);
        assert.deepEqual(saved.costumes[0].props, [' 腰带 ']);
        assert.equal(saved.costume_images[0].address, 'keep.png');
        assert.equal(saved.costume_images[0].node_state.status, 'expired');
        assert.equal(saved.costume_images[0].node_state.dependency_hash, 'a'.repeat(64));
        const revision = model.read().runtime.revision;
        await upgraded.close();
        const reopened = new ModelRepository(root);
        assert.equal((await reopened.open(p.id)).read().runtime.revision, revision);
        await reopened.close();
      }
      const backups = (await readdir(root)).filter(name => name.includes('before-v7'));
      assert.equal(backups.length, 1);
      const backup = new DatabaseSync(join(root, backups[0]));
      assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 5);
      assert.equal(backup.prepare('SELECT data_json FROM projects').get().data_json, old);
      backup.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
