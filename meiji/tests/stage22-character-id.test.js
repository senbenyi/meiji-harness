import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectFixture } from './fixtures/project.js';
import { seedQueuedTasks } from './fixtures/queued-tasks.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { mergeCharacters } from '../shared/collection-identity.js';
import { characterTextCatalog, shotTextInputs } from '../shared/shot-text-inputs.js';
import { stampDependencyHash, isNodeCurrent } from '../shared/node-dependencies.js';
import { prepareContent } from '../server/handlers/content.js';
import { nodeRoutes } from '../server/http/nodes/index.js';

const person = name => ({ name, gender: '男', era: '现代', position: '', age_range: '', body_type: '', hairstyle: '', signature_props: [], immutable_traits: [], costumes: [{ name: '常服', color: '白', material: '棉', props: [] }] });
function setup() {
  const project = projectFixture();
  project.character_library.characters = mergeCharacters(project, [person('甲'), person('乙')]).characters;
  return project;
}

test('提取保留唯一ID，镜头表直接校验所属服装并传给每秒分镜', () => {
  const project = setup(), [a, b] = project.character_library.characters;
  const repeated = mergeCharacters(project, [person('甲')]).characters[0];
  assert.equal(repeated.id, a.id); assert.equal(repeated.costumes[0].id, a.costumes[0].id);
  assert.equal(Object.hasOwn(repeated, 'number'), false);
  const episode = project.episodes[0], shot = episode.shot_list.shots[0];
  const input = { characters: characterTextCatalog(project) };
  const binding = { character_id: a.id, costume_id: a.costumes[0].id };
  const value = { shots: [{ ...structuredClone(nodeRoutes.shots.actions.generate.output.structure.shots[0]), id: '', duration_seconds: 5, body: '甲走入', on_screen_characters: [binding], background_characters: '' }] };
  const route = nodeRoutes.shots;
  route.validateResult(value, input, 'generate');
  const bad = structuredClone(value); bad.shots[0].on_screen_characters[0].costume_id = b.costumes[0].id;
  assert.throws(() => route.validateResult(bad, input, 'generate'), /属于/);
  bad.shots[0].on_screen_characters = [binding, binding];
  assert.throws(() => route.validateResult(bad, input, 'generate'), /重复/);
  const result = prepareContent({ project, tasks: [], steps: [] }, { business_type: 'shots', target_id: episode.id }, value);
  episode.shot_list.shots = result.shots;
  assert.deepEqual(shotTextInputs(project, episode, result.shots[0], 'seconds').shot.on_screen_characters, [binding]);
});

test('v18迁移只移除正式角色服装编号，保留ID、绑定、图片和历史；二次启动不重复迁移', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-single-id-'));
  try {
    let repo = new ModelRepository(root);
    const project = setup(), character = project.character_library.characters[0], costume = character.costumes[0];
    const episode = project.episodes[0], shot = episode.shot_list.shots[0];
    character.costume_images[0].address = 'kept.png';
    shot.on_screen_characters = [{ character_id: character.id, costume_id: costume.id }];
    const model = await repo.create(project);
    await seedQueuedTasks(model, [['project-summary', project.id]]);
    await repo.close();
    const path = join(root, 'meiji.sqlite');
    let db = new DatabaseSync(path);
    const row = db.prepare('SELECT data_json FROM projects WHERE id=?').get(project.id);
    const legacy = JSON.parse(row.data_json);
    legacy.character_library.characters.forEach((c, i) => {
      c.number = `C${i + 1}`;
      c.costumes.forEach((co, j) => { co.number = `${c.number}-${j + 1}`; });
    });
    const snapshot = { project: legacy, tasks: [], steps: [] };
    stampDependencyHash(snapshot, 'shots', episode.id);
    legacy.episodes[0].shot_list.node_state.status = 'generated';
    // 模拟旧输入投影对应的历史指纹；迁移应按同一业务资料的新ID投影重写。
    legacy.episodes[0].shot_list.node_state.dependency_hash = 'a'.repeat(64);
    db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(legacy), project.id);
    // 历史提示词/结果保留旧协议，不拿新目录重写历史。
    const legacyRecord = JSON.stringify({ character_number: 'C1', costume_number: 'C1-1' });
    db.prepare('UPDATE task_steps SET prompt_json=?,result_json=?').run(legacyRecord, legacyRecord);
    const history = db.prepare('SELECT * FROM task_steps').all();
    const taskHistory = db.prepare('SELECT * FROM tasks').all();
    db.exec('DELETE FROM schema_migrations WHERE version>=19; PRAGMA user_version=18');
    db.close();
    repo = new ModelRepository(root);
    const restored = (await repo.open(project.id)).read();
    const saved = restored.project.character_library.characters[0];
    assert.equal(saved.id, character.id);
    assert.equal(saved.costumes[0].id, costume.id);
    assert.equal(saved.costume_images[0].address, 'kept.png');
    assert.equal(Object.hasOwn(saved, 'number'), false);
    assert.equal(Object.hasOwn(saved.costumes[0], 'number'), false);
    assert.deepEqual(restored.project.episodes[0].shot_list.shots[0].on_screen_characters, shot.on_screen_characters);
    assert.equal(isNodeCurrent(restored, 'shots', episode.id), true);
    assert.deepEqual(JSON.parse(await readFile(join(root, project.id, 'project.json'), 'utf8')), restored.project);
    await repo.close();
    db = new DatabaseSync(path);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
    assert.deepEqual(db.prepare('SELECT * FROM task_steps').all(), history);
    assert.deepEqual(db.prepare('SELECT * FROM tasks').all(), taskHistory);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const before = db.prepare('SELECT data_json,revision FROM projects').all();
    db.close();
    repo = new ModelRepository(root); await repo.close();
    db = new DatabaseSync(path);
    assert.deepEqual(db.prepare('SELECT data_json,revision FROM projects').all(), before);
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
