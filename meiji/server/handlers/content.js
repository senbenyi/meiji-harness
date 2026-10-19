import { mergeScenes, sceneCatalog, sceneText } from '../../shared/scene-inputs.js';
import storyboardRoute from '../http/nodes/storyboard.js';
import { parseSections } from '../prompts/parse-sections.js';
import { expireDownstream, stampDependencyHash } from "../../shared/node-dependencies.js";
import { applyDelete } from "./deletion-handler.js";
import { nodeOf, locateTarget, invalid } from "../../shared/task_contract.js";
import { mergeCharacters, replaceShots } from "../../shared/collection-identity.js";
import { assertOutput, assertOverride } from "../../shared/node-state.js";
import { emptyEpisode, validateProject } from "../../shared/project_contract.js";
import { emptyCostumeImageModel } from "../../shared/models/costume_image_model.js";
import { emptyNodeStateModel } from "../../shared/models/node_state_model.js";
import { updateEpisodeActualDuration } from "../../shared/models/episode_model.js";
import { buildSplit } from "./script-split.js";


export function aiProjection(value) {
  const walk = (item) => Array.isArray(item) ? item.map(walk) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).flatMap(([key, data]) => {
        if (["adaptation_rules", "rules", "id", "node_state", "address", "reference_image", "revision_history", "new_ids", "removed_ids"].includes(key)) return [];
        if (key === "speaker_id") return [[key, data]];
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
  if (business === 'episode-scenes') {
    content = mergeScenes(project, raw.scenes, { updateExisting: ['manual_edit', 'revise'].includes(task.action) });
  } else if (business === "project-characters") {
    content = { ...mergeCharacters(project, raw.characters), changes: structuredClone(raw.characters) };
  } else if (["script-review", "project-summary", "episode-summary"].includes(business)) {
    if (typeof raw !== "string" || !raw.trim()) invalid(business, business === "script-review" ? "改编后的剧本为空" : "摘要内容为空");
    content = { body: raw.trim() };
  } else if (business === "storyboard") {
    content = parseSections(raw, storyboardRoute.actions.generate.output.sections);
  } else if (business === "shots") {
    content = replaceShots(project, target.episode.id, raw.shots, snapshot.tasks);
  } else {
    content = structuredClone(raw);
    if (business === "seconds")
      for (const [beatIndex, beat] of content.storyboard.entries())
        for (const [lineIndex, line] of beat.dialogue.entries()) {
          if (line.speaker_id && !project.character_library.characters.some(c => c.id === line.speaker_id)) {
            const catalog = project.character_library.characters;
            const named = catalog.filter(c => c.name === line.speaker_name);
            const candidates = (named.length === 1 ? named : catalog).map(c => `${c.name}=${c.id}`).join('；');
            invalid(`speaker_id（storyboard[${beatIndex}].dialogue[${lineIndex}]，${beat.time_range}）`,
              `未知角色ID ${line.speaker_id}，说话人${line.speaker_name}；从角色目录原样复制对应ID，不得拼接服装ID。目录：${candidates}`);
          }
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
  let changedScenes = [];
  if (task.action === "delete") { applyDelete(snapshot, task); return []; }
  if (business === "script-split" && task.action === "override") {
    project.episodes = buildSplit(project.script.body, content, project.reference_episode_duration_seconds).episodes.map(row => emptyEpisode(row));
    assertOutput(project, business, task.target_id);
    return [];
  }
  if (task.action === "override") {
    assertOverride(project, business, task.target_id);
    stampDependencyHash(snapshot, business, task.target_id);
    if (business === "project-characters") expireCharacterImages(snapshot);
    return [];
  }
  if (business === "script-split") {
    if (!passed) return [];
    project.episodes = buildSplit(project.script.body, content, project.reference_episode_duration_seconds).episodes.map(row => emptyEpisode(row));
    assertOutput(project, business, task.target_id);
    return [];
  }
  const node = nodeOf(project, business, task.target_id);
  if (business === 'script-review') {
    if (typeof content?.body !== 'string' || !content.body.trim()) invalid('剧本','正文为空');
    if (content.body !== node.body) {
      node.body=content.body;
      node.version++;
      node.updated_at=new Date().toISOString();
      node.revision_history.push({timestamp:node.updated_at,task_id:task.id,revision_notes:task.opinion || '人工编辑剧本'});
    }
  } else if (business === 'episode-scenes') {
    if (!passed) return [];
    const previousText = new Map(project.scene_library.scenes.map(scene => [scene.id, JSON.stringify(sceneText(scene))]));
    changedScenes = content.scenes.filter(scene => previousText.has(scene.id) && previousText.get(scene.id) !== JSON.stringify(sceneText(scene))).map(scene => scene.id);
    project.scene_library.scenes = structuredClone(content.scenes);
    node.scene_ids = [...content.scene_ids];
    node.has_result = true;
  } else if (business === "project-characters") {
    node.characters = structuredClone(content.characters);
    // 即使没有角色增量，也补齐每个角色的图片槽位；槽位不是虚构的服装资料。
    for (const character of node.characters)
      for (const costume_id of character.costumes.length ? character.costumes.map(costume => costume.id) : [""])
        if (!character.costume_images.some(image => image.costume_id === costume_id))
          character.costume_images.push(emptyCostumeImageModel(costume_id));
  } else if (["scene-image", "costume-image", "video", "tail", "assembly"].includes(business)) {
    node.address = content.address;
    if (business === 'video') {
      if (typeof content.server_address === 'string') node.server_address = content.server_address;
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
  stampDependencyHash(snapshot, business, task.target_id);
  if (business === 'video') stampDependencyHash(snapshot, 'tail', task.target_id);
  if (business === 'episode-scenes') {
    // 只有资料实际变化的已有场景才使参考图和引用镜头过期；直接复用的场景不受影响。
    for (const id of changedScenes) expireDownstream(snapshot, 'scene-setting', id, '场景资料已更新');
  }
  if (business !== "project-characters") return [];
  // 正式资料可能已保存过拒绝候选，是否过期须与图片生成时的依赖 hash 比较。
  expireCharacterImages(snapshot);
  if (extractionTask(task)) detachExtractedPhotos(node.characters, content.changes);
  return [];
}
