import { expireDownstream, stampDependencyHash } from "../../shared/node-dependencies.js";
import { applyDelete } from "./deletion-handler.js";
import { nodeOf, locateTarget, invalid } from "../../shared/task_contract.js";
import { mergeCharacters, replaceShots } from "../../shared/collection-identity.js";
import { assertOutput, assertProgramReview } from "../../shared/node-state.js";
import { emptyEpisode, validateProject } from "../../shared/project_contract.js";
import { emptyCostumeImageModel } from "../../shared/models/costume_image_model.js";
import { updateEpisodeActualDuration } from "../../shared/models/episode_model.js";
import { buildSplit } from "./script-split.js";

export function validateShape(value, shape, path = "响应") {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) invalid(path, "需为数组");
    for (const row of value) validateShape(row, shape[0], path + "[]");
    return;
  }
  if (shape && typeof shape === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "需为对象");
    for (const key of Object.keys(value)) if (!Object.hasOwn(shape, key)) invalid(path + "." + key, "未定义字段");
    for (const key of Object.keys(shape)) {
      if (!Object.hasOwn(value, key)) invalid(path + "." + key, "缺少字段");
      validateShape(value[key], shape[key], path + "." + key);
    }
    return;
  }
  if (typeof value !== typeof shape) invalid(path, `需为 ${typeof shape}`);
}

export function aiProjection(value) {
  const walk = (item) => Array.isArray(item) ? item.map(walk) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).flatMap(([key, data]) => {
        if (["id", "node_state", "address", "reference_image", "revision_history", "new_ids", "removed_ids"].includes(key)) return [];
        if (key === "speaker_id") return [[key, ""]];
        if (key.endsWith("_id")) return [];

        return [[key, walk(data)]];
      })) : item;
  return walk(value);
}

function textPrompt(raw) {
  const keys = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
  const matches = [...raw.matchAll(/^(?:#{1,6}[ \t]*)?(integrated_multimodal_description|overall_soundscape|non_diegetic_music)[ \t]*[:：]?[ \t]*/gm)];
  if (matches.length !== 3 || matches.some((match, index) => match[1] !== keys[index]))
    invalid("文生视频提示词", "需依次包含规定的三个段落标题");
  return Object.fromEntries(matches.map((match, index) => [match[1], raw.slice(match.index + match[0].length, matches[index + 1]?.index ?? raw.length).trim()]));
}

export function prepareContent(snapshot, task, raw) {
  const project = snapshot.project, business = task.business_type;
  const target = locateTarget(project, business, task.target_id);
  if (business === "script-split") return structuredClone(raw);
  let content;
  if (business === "project-characters") {
    content = { ...mergeCharacters(project, raw.characters), changes: structuredClone(raw.characters) };
  } else if (["project-summary", "episode-summary"].includes(business)) {
    if (typeof raw !== "string" || !raw.trim()) invalid(business, "摘要内容为空");
    content = { body: raw.trim() };
  } else if (business === "storyboard") {
    content = textPrompt(raw);
  } else if (business === "shots") {
    content = replaceShots(project, target.episode.id, raw.shots, snapshot.tasks);
  } else {
    content = structuredClone(raw);
    if (business === "seconds")
      for (const beat of content.storyboard)
        for (const line of beat.dialogue) {
          const character = project.character_library.characters.find(c => c.name === line.speaker_name);
          if (line.speaker_id && !project.character_library.characters.some(c => c.id === line.speaker_id))
            invalid("speaker_id", "未知角色");
          line.speaker_id = character?.id || line.speaker_id;
        }
  }
  // 这里只检验可保存结构。业务审核单独执行，失败候选仍能进入修订和最终未通过态。
  commitContent(structuredClone(snapshot), task, content, { passed: false });
  return content;
}

function expireCharacterImages(snapshot) {
  for (const character of snapshot.project.character_library.characters)
    expireDownstream(snapshot, "character-setting", character.id, "人物或服装资料已修改");
}

export function commitContent(snapshot, task, content, { passed = true } = {}) {
  const project = snapshot.project, business = task.business_type;
  if (task.action === "delete") { applyDelete(snapshot, task); return []; }
  if (task.action === "override") {
    assertProgramReview(project, business, task.target_id);
    stampDependencyHash(snapshot, business, task.target_id);
    if (business === "project-characters") expireCharacterImages(snapshot);
    return [];
  }
  if (business === "script-split") {
    if (!passed) return [];
    project.episodes = buildSplit(project.script.body, content).episodes.map(row => emptyEpisode(row));
    assertOutput(project, business, task.target_id);
    return [];
  }
  const node = nodeOf(project, business, task.target_id);
  if (business === "project-characters") {
    node.characters = structuredClone(content.characters);
    // 即使没有角色增量，也补齐每个角色的图片槽位；槽位不是虚构的服装资料。
    for (const character of node.characters)
      for (const costume_id of character.costumes.length ? character.costumes.map(costume => costume.id) : [""])
        if (!character.costume_images.some(image => image.costume_id === costume_id))
          character.costume_images.push(emptyCostumeImageModel(costume_id));
  } else if (["costume-image", "video", "tail", "assembly"].includes(business)) {
    node.address = content.address;
    if (business === "video" && content.actual_duration_seconds !== undefined)
      locateTarget(project, business, task.target_id).object.actual_duration_seconds = content.actual_duration_seconds;
  } else if (business === "shots") node.shots = structuredClone(content.shots);
  else Object.assign(node, structuredClone(content));
  if (business === "project-summary") node.script_version = project.script.version;
  if (["video", "shots"].includes(business))
    updateEpisodeActualDuration(locateTarget(project, business, task.target_id).episode);
  validateProject(project);
  if (!passed) return [];
  assertOutput(project, business, task.target_id);
  stampDependencyHash(snapshot, business, task.target_id);
  if (business !== "project-characters") return [];
  // 正式资料可能已保存过拒绝候选，是否过期须与图片生成时的依赖 hash 比较。
  expireCharacterImages(snapshot);
  return [];
}
