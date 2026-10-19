import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mergeCharacters, replaceShots } from "../shared/collection-identity.js";
import { emptyProject, emptyEpisode, emptyShot } from "../shared/project_contract.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectFixture } from "./fixtures/project.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { characterTextCatalog, shotTextInputs } from "../shared/shot-text-inputs.js";
import { stampDependencyHash, isNodeCurrent } from "../shared/node-dependencies.js";
import { prepareContent } from "../server/handlers/content.js";
import { nodeRoutes } from "../server/http/nodes/index.js";

describe("identity", () => {
  const character = (name = "甲", costumes = [{ name: "常服", color: "蓝", material: "布", props: [] }]) => ({ name, gender: "男", era: "宋代", position: "主角", age_range: "三十来岁", body_type: "高大", hairstyle: "束发", signature_props: [], immutable_traits: [], costumes });
  const shot = (id = "") => {
    const value = emptyShot({ id, title: "镜头", body: "剧情", duration_seconds: 5 });
    return Object.fromEntries(["title", "id", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement", "on_screen_characters", "background_characters"].map(key => [key, value[key]]));
  };

  test("角色提取性别必填，更新性别保留已有身份与图片", () => {
    const p = emptyProject();
    for (const gender of [undefined, null, 1, "", " \n\t"]) {
      const row = { ...character(), gender };
      if (gender === undefined) delete row.gender;
      assert.throws(() => mergeCharacters(p, [row]), /gender|字段/);
      assert.deepEqual(p.character_library.characters, []);
    }
    p.character_library.characters = mergeCharacters(p, [{ ...character(), gender: "未明确" }]).characters;
    const original = p.character_library.characters[0];
    original.costume_images[0].address = "keep.png";
    const updated = mergeCharacters(p, [{ ...character(), gender: "女" }]).characters[0];
    assert.equal(updated.gender, "女");
    assert.equal(updated.id, original.id);
    assert.equal(updated.costume_images[0].address, "keep.png");
    original.facial_features = "眉骨分明";
    const kept = mergeCharacters(p, [character()]).characters[0];
    assert.equal(kept.facial_features, "眉骨分明");
    const filled = mergeCharacters(p, [{ ...character(), facial_features: "方脸（背景补）", height: "中等（背景补）", nationality: "", voice: "低沉（背景补）" }]).characters[0];
    assert.equal(filled.facial_features, "方脸（背景补）");
    assert.equal(filled.height, "中等（背景补）");
    assert.equal(filled.voice, "低沉（背景补）");
  });

  test("角色提取年代必填，有效年代保存且保留角色身份", () => {
    const p = emptyProject();
    for (const era of [undefined, null, 1, "", " \n "]) {
      const row = { ...character(), era };
      if (era === undefined) delete row.era;
      assert.throws(() => mergeCharacters(p, [row]), /era/);
      assert.equal(p.character_library.characters.length, 0);
    }
    p.character_library.characters = mergeCharacters(p, [{ ...character(), era: "未明确" }]).characters;
    const updated = mergeCharacters(p, [{ ...character(), era: "宋代" }]).characters[0];
    assert.equal(updated.era, "宋代");
    assert.equal(updated.id, p.character_library.characters[0].id);
  });

  test("姓名增量合并保留 ID、资源与未参与输出的资料", () => {
    const p = emptyProject();
    p.character_library.characters = mergeCharacters(p, [character()]).characters;
    const first = p.character_library.characters[0];
    first.costume_images[0].address = "keep.png";
    first.voice = "低沉";
    const merged = mergeCharacters(p, [{ ...character(), position: "主人公" }, character("乙")]);
    assert.equal(merged.characters[0].id, first.id);
    assert.equal(merged.characters[0].costumes[0].id, first.costumes[0].id);
    assert.equal(merged.characters[0].costume_images[0].address, "keep.png");
    assert.equal(merged.characters[0].voice, "低沉");
    assert.equal(merged.characters[0].age_range, "三十来岁");
    assert.equal(merged.new_ids.length, 2);
    p.character_library.characters = merged.characters;
    assert.deepEqual(mergeCharacters(p, []).characters, merged.characters);
    const before = structuredClone(p);
    assert.throws(() => mergeCharacters(p, [character(), character()]), /重复/);
    assert.throws(() => mergeCharacters(p, [{ ...character(), number: "C01" }]), /字段/);
    assert.deepEqual(p, before);
  });

  test("无服装资料保留空数组并建立一个未绑定定妆照槽位", () => {
    const p = emptyProject();
    const result = mergeCharacters(p, [character("无服装", [])]).characters[0];
    assert.deepEqual(result.costumes, []);
    assert.equal(result.default_costume_id, "");
    assert.equal(result.costume_images.length, 1);
    assert.equal(result.costume_images[0].costume_id, "");
    assert.ok(!Object.hasOwn(result, "clothing_color"));
  });

  test("镜头重生成保留身份与资源，移除受占用镜头", () => {
    const p = emptyProject(), e = emptyEpisode();
    p.episodes = [e];
    e.shot_list.shots = replaceShots(p, e.id, [shot()]).shots;
    const id = e.shot_list.shots[0].id;
    e.shot_list.shots[0].video.address = "keep.mp4";
    const replaced = replaceShots(p, e.id, [shot(id), shot()]);
    assert.equal(replaced.shots[0].id, id);
    assert.equal(replaced.shots[0].video.address, "keep.mp4");
    assert.notEqual(replaced.shots[1].id, id);
    assert.throws(() => replaceShots(p, e.id, [], [{ target_id: id, task_status: "running" }]), /未结束/);
    assert.deepEqual(replaceShots(p, e.id, [], [{ target_id: id, task_status: "completed" }]).removed_ids, [id]);
  });


  test('镜头编号按播放顺序生成，按内部ID重排保留资源，新增不复用身份', () => {
    const p = emptyProject(), e = emptyEpisode(); p.episodes = [e];
    e.shot_list.shots = replaceShots(p, e.id, [shot(), shot()]).shots;
    const [a,b] = e.shot_list.shots;
    a.video.address = 'a.mp4'; b.video.address = 'b.mp4';
    const result = replaceShots(p, e.id, [shot(b.id), shot(), shot(a.id)]);
    assert.deepEqual(result.shots.map(s => s.number), ['S01','S02','S03']);
    assert.deepEqual([result.shots[0].id,result.shots[2].id], [b.id,a.id]);
    assert.deepEqual([result.shots[0].video.address,result.shots[2].video.address], ['b.mp4','a.mp4']);
    assert.ok(![a.id,b.id].includes(result.shots[1].id));
    assert.throws(() => replaceShots(p,e.id,[shot(a.id),shot(a.id)]), /重复镜头ID/);
    assert.throws(() => replaceShots(p,e.id,[shot('s_unknown')]), /未知或重复镜头ID/);
    assert.throws(() => replaceShots(p,e.id,[{...shot(),number:'S01'}]), /字段/);
  });
});

describe("character-id", () => {
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
    const episode = project.episodes[0];
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
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 28);
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
});
