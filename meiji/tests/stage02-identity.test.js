import test from "node:test";
import assert from "node:assert/strict";
import { mergeCharacters, replaceShots } from "../shared/collection-identity.js";
import { emptyProject, emptyEpisode, emptyShot } from "../shared/project_contract.js";
import { emptyRuleModel } from "../shared/models/rule_model.js";

const character = (name = "甲", costumes = [{ name: "常服", color: "蓝", material: "布", props: "" }]) => ({ name, position: "主角", age_range: "三十来岁", body_type: "高大", hairstyle: "束发", signature_props: "", immutable_traits: "", costumes });
const shot = (number = "S01") => {
  const value = emptyShot({ number, title: "镜头", body: "剧情", duration_seconds: 5 });
  return Object.fromEntries(["title", "number", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement"].map(key => [key, value[key]]));
};

test("S2-07 姓名增量合并保留 ID、编号、资源与未参与输出的资料", () => {
  const p = emptyProject();
  p.character_library.characters = mergeCharacters(p, [character()]).characters;
  const first = p.character_library.characters[0];
  first.character_image.address = "keep.png";
  first.voice = "低沉";
  const merged = mergeCharacters(p, [{ ...character(), position: "主人公" }, character("乙")]);
  assert.equal(merged.characters[0].id, first.id);
  assert.equal(merged.characters[0].costumes[0].id, first.costumes[0].id);
  assert.equal(merged.characters[0].character_image.address, "keep.png");
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

test("S2-07 镜头重生成保留身份与资源，移除受占用和规则保护", () => {
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
  p.rules = [emptyRuleModel({ scope: "node", node_id: id, applicable_business_types: ["video"], category: "动作", constraint: "必须", content: "规则" })];
  assert.throws(() => replaceShots(p, e.id, []), /规则引用/);
});
