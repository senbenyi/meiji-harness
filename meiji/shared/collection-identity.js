import { assertFields, assertText, invalid } from "./task_contract.js";
import { emptyShot, validateProject } from "./project_contract.js";
import { emptyCharacterModel } from "./models/character_model.js";
import { emptyCostumeModel } from "./models/costume_model.js";
import { emptyCostumeImageModel } from "./models/costume_image_model.js";

const characterFields = ["name", "gender", "era", "position", "age_range", "body_type", "hairstyle", "signature_props", "immutable_traits", "costumes"];
const costumeFields = ["name", "color", "material", "props"];
const shotFields = ["title", "id", "duration_seconds", "shot_scale", "hook", "body", "on_screen_characters", "background_characters", "continuity_transition", "reference_anchor", "audio_arrangement"];

// AI 只提供资料增量，唯一ID由程序维护；未返回的对象不表示删除。
export function mergeCharacters(project, rows) {
  if (!Array.isArray(rows)) invalid("characters", "需为数组");
  const draft = structuredClone(project), characters = draft.character_library.characters;
  const seen = new Set(), new_ids = [];
  for (const row of rows) {
    assertFields(row, characterFields, "characters[]");
    for (const key of characterFields.filter(key => !["costumes", "signature_props", "immutable_traits"].includes(key))) assertText(row[key], `character.${key}`);
    if (!row.era.trim()) invalid("character.era", "年代必填；剧本未明确时填写“未明确”");
    if (!row.gender.trim()) invalid("character.gender", "性别必填；剧本未明确时填写“未明确”");
    if (!row.name.trim() || seen.has(row.name)) invalid("character.name", "重复或空姓名");
    seen.add(row.name);
    const matches = characters.filter(c => c.name === row.name);
    if (matches.length > 1) invalid("character.name", "已有角色同名，无法唯一关联");
    let character = matches[0];
    if (!character) {
      character = emptyCharacterModel();
      characters.push(character);
      new_ids.push(character.id);
    }
    if (!Array.isArray(row.costumes)) invalid("character.costumes", "需为数组");
    const seenCostumes = new Set();
    for (const data of row.costumes) {
      assertFields(data, costumeFields, "costumes[]");
      for (const key of costumeFields.filter(key => key !== "props")) assertText(data[key], `costume.${key}`);
      if (!data.name.trim() || seenCostumes.has(data.name)) invalid("costume.name", "重复或空名称");
      seenCostumes.add(data.name);
      const matches = character.costumes.filter(co => co.name === data.name);
      if (matches.length > 1) invalid("costume.name", "已有服装同名，无法唯一关联");
      let costume = matches[0];
      if (!costume) {
        costume = emptyCostumeModel();
        character.costumes.push(costume);
        new_ids.push(costume.id);
      }
      Object.assign(costume, structuredClone(data));
    }
    for (const key of characterFields.filter(key => key !== "costumes")) character[key] = structuredClone(row[key]);
    if (character.costumes.length) character.costume_images = character.costume_images.filter(image => image.costume_id || image.address);
    for (const costume_id of character.costumes.length ? character.costumes.map(co => co.id) : [""])
      if (!character.costume_images.some(image => image.costume_id === costume_id))
        character.costume_images.push(emptyCostumeImageModel(costume_id));
  }
  validateProject(draft);
  return { characters, new_ids };
}

export function replaceShots(project, episodeId, rows, tasks = []) {
  if (!Array.isArray(rows)) invalid("shots", "需为数组");
  const draft = structuredClone(project), episode = draft.episodes.find(e => e.id === episodeId);
  if (!episode) invalid("episode_id", "剧集不存在");
  const byId = new Map(episode.shot_list.shots.map(shot => [shot.id, shot])), seen = new Set();
  const next = rows.map((row, index) => {
    const sceneKeys = ['scene_id','scene_state','scene_transition'];
    assertFields(row, [...shotFields, ...sceneKeys.filter(key => Object.hasOwn(row,key))], "shots[]");
    assertText(row.id, "shot.id");
    if (row.id && (!byId.has(row.id) || seen.has(row.id))) invalid(`shots[${index}].id`, `未知或重复镜头ID ${row.id}；旧镜头原样复制id且不可重复，新增镜头id为空。可关联旧镜头：${JSON.stringify(episode.shot_list.shots.map(shot => ({ id: shot.id, title: shot.title })))}`);
    if (row.id) seen.add(row.id);
    const { id, ...content } = structuredClone(row);
    return { ...(byId.get(id) || emptyShot()), ...content, number: `S${String(index + 1).padStart(2, '0')}`, sequence: index + 1 };
  });
  const retained = new Set(next.map(shot => shot.id)), removed = episode.shot_list.shots.filter(shot => !retained.has(shot.id));
  for (const shot of removed) {
    if (tasks.some(task => task.target_id === shot.id && ["queued", "running"].includes(task.task_status)))
      invalid("shots", "被移除镜头仍有未结束任务");
  }
  episode.shot_list.shots = next;
  validateProject(draft);
  return { shots: next, removed_ids: removed.map(shot => shot.id) };
}
