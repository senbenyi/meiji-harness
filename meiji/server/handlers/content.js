import storyboardRoute from '../http/nodes/storyboard.js';
import { parseSections } from '../prompts/parse-sections.js';
import { expireDownstream, stampDependencyHash } from "../../shared/node-dependencies.js";
import { applyDelete } from "./deletion-handler.js";
import { nodeOf, locateTarget, invalid } from "../../shared/task_contract.js";
import { mergeCharacters, replaceShots } from "../../shared/collection-identity.js";
import { assertOutput, assertProgramReview } from "../../shared/node-state.js";
import { emptyEpisode, validateProject } from "../../shared/project_contract.js";
import { emptyCostumeImageModel } from "../../shared/models/costume_image_model.js";
import { emptyNodeStateModel } from "../../shared/models/node_state_model.js";
import { updateEpisodeActualDuration } from "../../shared/models/episode_model.js";
import { buildSplit } from "./script-split.js";


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

export function prepareContent(snapshot, task, raw) {
  const project = snapshot.project, business = task.business_type;
  const target = locateTarget(project, business, task.target_id);
  if (business === "script-split") return structuredClone(raw);
  let content;
  if (business === "project-characters") {
    content = { ...mergeCharacters(project, raw.characters), changes: structuredClone(raw.characters) };
  } else if (business === "shot-characters") {
    content = { has_result: true, on_screen_characters: raw.on_screen_characters.map(row => {
      const person = project.character_library.characters.find(person => person.number === row.character_number);
      if (!person) invalid("镜头角色识别", "未知角色编号");
      const costume = person.costumes.find(costume => costume.number === row.costume_number);
      if (row.costume_number && !costume || person.costumes.length && !costume) invalid("镜头角色识别", "需指定该人物的有效服装编号");
      return { character_id: person.id, costume_id: costume?.id || '' };
    }) };  } else if (["project-summary", "episode-summary"].includes(business)) {
    if (typeof raw !== "string" || !raw.trim()) invalid(business, "摘要内容为空");
    content = { body: raw.trim() };
  } else if (business === "storyboard") {
    content = parseSections(raw, storyboardRoute.actions.generate.output.sections);
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

function extractionTask(task) {
  return ["generate", "regenerate", "revise"].includes(task.action);
}

function detachExtractedPhotos(characters, changes) {
  const names = new Set((changes || []).map(row => row.name));
  for (const character of characters) {
    if (!names.has(character.name)) continue;
    for (const image of character.costume_images) {
      image.address = "";
      image.node_state = emptyNodeStateModel();
    }
  }
}

export function commitContent(snapshot, task, content, { passed = true } = {}) {
  const project = snapshot.project, business = task.business_type;
  if (task.action === "delete") { applyDelete(snapshot, task); return []; }
  if (task.action === "override") {
    assertProgramReview(project, business, task.target_id);
    if (business === "outline") {
      const episode = locateTarget(project, business, task.target_id).episode;
      episode.duration_seconds = episode.story_outline.segments.reduce((sum, segment) => sum + segment.duration_seconds, 0);
    }
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
    if (business === 'video') {
      const shot = locateTarget(project, business, task.target_id).object;
      if (!content.last_frame?.address) invalid('视频', '缺少配对尾帧');
      shot.actual_duration_seconds = content.actual_duration_seconds;
      shot.last_frame.address = content.last_frame.address;
    }
  } else if (business === "shots") node.shots = structuredClone(content.shots);
  else Object.assign(node, structuredClone(content));
  if (['first-last-frame','multimodal'].includes(business)) locateTarget(project, business, task.target_id).object.video_generation_type = business === 'multimodal' ? '多模态' : '首尾帧';
  if (business === "project-summary") node.script_version = project.script.version;
  if (["video", "shots"].includes(business))
    updateEpisodeActualDuration(locateTarget(project, business, task.target_id).episode);
  validateProject(project);
  if (!passed) return [];
  assertOutput(project, business, task.target_id);
  if (business === "outline") {
    const episode = locateTarget(project, business, task.target_id).episode;
    episode.duration_seconds = node.segments.reduce((sum, segment) => sum + segment.duration_seconds, 0);
  }
  stampDependencyHash(snapshot, business, task.target_id);
  if (business === 'video') stampDependencyHash(snapshot, 'tail', task.target_id);
  if (business !== "project-characters") return [];
  // 正式资料可能已保存过拒绝候选，是否过期须与图片生成时的依赖 hash 比较。
  expireCharacterImages(snapshot);
  if (extractionTask(task)) detachExtractedPhotos(node.characters, content.changes);
  return [];
}
