import test from "node:test";
import assert from "node:assert/strict";
import { mergeCharacters, replaceShots } from "../shared/collection-identity.js";
import { emptyProject, emptyEpisode, emptyShot } from "../shared/project_contract.js";
const character = (name = "甲", costumes = [{ name: "常服", color: "蓝", material: "布", props: [] }]) => ({ name, gender: "男", era: "宋代", position: "主角", age_range: "三十来岁", body_type: "高大", hairstyle: "束发", signature_props: [], immutable_traits: [], costumes });
const shot = (number = "S01") => {
  const value = emptyShot({ number, title: "镜头", body: "剧情", duration_seconds: 5 });
  return Object.fromEntries(["title", "number", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement"].map(key => [key, value[key]]));
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

test("S2-07 姓名增量合并保留 ID、编号、资源与未参与输出的资料", () => {
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
  assert.throws(() => mergeCharacters(p, [{ ...character(), number: "C99" }]), /字段/);
  assert.deepEqual(p, before);
});

test("S2-07 无服装资料保留空数组并建立一个未绑定定妆照槽位", () => {
  const p = emptyProject();
  const result = mergeCharacters(p, [character("无服装", [])]).characters[0];
  assert.deepEqual(result.costumes, []);
  assert.equal(result.default_costume_id, "");
  assert.equal(result.costume_images.length, 1);
  assert.equal(result.costume_images[0].costume_id, "");
  assert.ok(!Object.hasOwn(result, "clothing_color"));
});

test("S2-07 镜头重生成保留身份与资源，移除受占用镜头", () => {
  const p = emptyProject(), e = emptyEpisode();
  p.episodes = [e];
  e.shot_list.shots = replaceShots(p, e.id, [shot()]).shots;
  const id = e.shot_list.shots[0].id;
  e.shot_list.shots[0].video.address = "keep.mp4";
  const replaced = replaceShots(p, e.id, [shot(), shot("S02")]);
  assert.equal(replaced.shots[0].id, id);
  assert.equal(replaced.shots[0].video.address, "keep.mp4");
  assert.notEqual(replaced.shots[1].id, id);
  assert.throws(() => replaceShots(p, e.id, [], [{ target_id: id, task_status: "running" }]), /未结束/);
  assert.deepEqual(replaceShots(p, e.id, [], [{ target_id: id, task_status: "completed" }]).removed_ids, [id]);
});
