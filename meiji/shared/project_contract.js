import {
  createId,
  assertId,
  assertEnum,
  assertFields,
  invalid,
} from "./task_contract.js";
import { emptyProjectModel } from "./models/project_model.js";
import { emptyScriptRevisionModel } from "./models/script_revision_model.js";
import { emptyCharacterModel } from "./models/character_model.js";
import { emptyCostumeImageModel } from "./models/costume_image_model.js";
import { emptyCostumeModel } from "./models/costume_model.js";
import { emptyEpisodeModel } from "./models/episode_model.js";
import { emptyStorySegmentModel } from "./models/story_segment_model.js";
import { emptyShotModel } from "./models/shot_model.js";
import { emptyOnScreenCharacterModel } from "./models/on_screen_character_model.js";
import { emptyStoryboardBeatModel } from "./models/storyboard_beat_model.js";
import { emptyDialogueModel } from "./models/dialogue_model.js";
import { emptyReferenceImageModel } from "./models/reference_image_model.js";

export const emptyProject = emptyProjectModel;
export const emptyEpisode = (fields = {}) =>
  emptyEpisodeModel(fields.sequence ?? 1, fields.duration_seconds ?? 150, fields);
export const emptyShot = (fields = {}) =>
  emptyShotModel(fields.sequence ?? 1, fields);

const arrayModels = {
  "project.script.revision_history": emptyScriptRevisionModel,
  "project.character_library.characters": emptyCharacterModel,
  "project.character_library.characters[].costume_images": () => emptyCostumeImageModel(),
  "project.character_library.characters[].costumes": emptyCostumeModel,
  "project.episodes": () => emptyEpisodeModel(),
  "project.episodes[].story_outline.segments": () => emptyStorySegmentModel(),
  "project.episodes[].shot_list.shots": () => emptyShotModel(),
  "project.episodes[].shot_list.shots[].character_binding.on_screen_characters": emptyOnScreenCharacterModel,
  "project.episodes[].shot_list.shots[].seconds_storyboard.storyboard": emptyStoryboardBeatModel,
  "project.episodes[].shot_list.shots[].seconds_storyboard.storyboard[].dialogue": emptyDialogueModel,
  "project.episodes[].shot_list.shots[].multimodal_prompt.reference_images": emptyReferenceImageModel,
};
const stringArrays = new Set([
  "project.character_library.characters[].signature_props",
  "project.character_library.characters[].immutable_traits",
  "project.character_library.characters[].costumes[].props",
]);
const normalizePath = (path) => path.replace(/\[\d+\]/g, "[]");

function assertModel(value, model, path) {
  if (Array.isArray(model)) {
    if (!Array.isArray(value)) invalid(path, "需为数组");
    const key = normalizePath(path);
    const itemModel = arrayModels[key];
    for (let i = 0; i < value.length; i++) {
      if (itemModel) assertModel(value[i], itemModel(), `${path}[${i}]`);
      else if (stringArrays.has(key)) {
        if (typeof value[i] !== "string") invalid(`${path}[${i}]`, "需为文本");
      } else invalid(path, "未定义数组项模型");
    }
    return;
  }
  if (model && typeof model === "object") {
    assertFields(value, Object.keys(model), path);
    for (const key of Object.keys(model))
      assertModel(value[key], model[key], `${path}.${key}`);
    return;
  }
  if (typeof value !== typeof model) invalid(path, `需为${typeof model}`);
}

function validateNodeState(node, path) {
  assertEnum(
    node.status,
    ["empty", "running", "generated", "rejected", "failed", "cancelled", "expired"],
    `${path}.status`,
  );
  if (typeof node.reason !== "string") invalid(`${path}.reason`, "需为文本");
  if (typeof node.fail_message !== "string") invalid(`${path}.fail_message`, "需为文本");
  if (typeof node.dependency_hash !== "string")
    invalid(`${path}.dependency_hash`, "需为文本");
  if (node.dependency_hash && !/^[a-f0-9]{64}$/.test(node.dependency_hash))
    invalid(`${path}.dependency_hash`, "需为空或依赖指纹");
  const needsReason = ["rejected", "cancelled", "expired"].includes(node.status);
  const needsFail = node.status === "failed";
  if (needsReason !== Boolean(node.reason.trim()))
    invalid(`${path}.reason`, needsReason ? "当前状态必须有原因" : "当前状态原因为空");
  if (needsFail !== Boolean(node.fail_message.trim()))
    invalid(`${path}.fail_message`, needsFail ? "失败必须有失败说明" : "当前状态失败说明为空");
}

function healFailureMessages(value) {
  if (!value || typeof value !== "object") return;
  if (value.node_state && typeof value.node_state.status === "string") {
    const state = value.node_state;
    if (typeof state.fail_message !== "string") state.fail_message = "";
    if (state.status === "failed" && typeof state.reason === "string" && state.reason.trim() && !state.fail_message.trim()) {
      state.fail_message = state.reason;
      state.reason = "";
    }
  }
  for (const child of Object.values(value)) if (child && typeof child === "object") healFailureMessages(child);
}
export function validateProject(project) {
  healFailureMessages(project);
  assertModel(project, emptyProjectModel(), "project");
  const ids = new Set();
  const register = (value, path) => {
    assertId(value, path);
    if (ids.has(value)) invalid(path, "重复 ID");
    ids.add(value);
  };
  register(project.id, "project.id");
  if (!/^\d+x\d+$/.test(project.aspect_ratio)) invalid("project.aspect_ratio", "需为分辨率");
  assertEnum(project.creation_mode, ["剧本", "自由创作"], "project.creation_mode");
  if (!Number.isInteger(project.reference_episode_duration_seconds) || project.reference_episode_duration_seconds < 1)
    invalid("project.reference_episode_duration_seconds", "需为正整数");

  const characters = new Map();
  const costumes = new Map();
  const numbers = new Set();
  const numbered = (value, path) => {
    if (!value || numbers.has(value)) invalid(path, "重复或空编号");
    numbers.add(value);
  };
  const nodes = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.node_state) nodes.push([value.node_state, "node_state"]);
    if (Array.isArray(value)) value.forEach(collect);
    else Object.values(value).forEach(collect);
  };
  collect(project);
  for (const [node, path] of nodes) validateNodeState(node, path);

  for (const character of project.character_library.characters) {
    register(character.id, "character_library.characters.id");
    numbered(character.number, "character_library.characters.number");
    characters.set(character.id, character);
    const characterCostumes = new Set();
    for (const costume of character.costumes) {
      register(costume.id, "character_library.characters.costumes.id");
      numbered(costume.number, "character_library.characters.costumes.number");
      costumes.set(costume.id, character.id);
      characterCostumes.add(costume.id);
    }
    if (character.default_costume_id && !characterCostumes.has(character.default_costume_id))
      invalid("character_library.characters.default_costume_id", "服装不属于该角色");
    const imageKeys = new Set();
    for (const image of character.costume_images) {
      if (imageKeys.has(image.costume_id))
        invalid("character_library.characters.costume_images.costume_id", "同一服装只能有一个定妆照节点");
      imageKeys.add(image.costume_id);
      if (image.costume_id && !characterCostumes.has(image.costume_id))
        invalid("character_library.characters.costume_images.costume_id", "服装不属于该角色");
    }
  }
  const checkTimeRange = (value, path) => {
    const matched = String(value.time_range).match(/^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s$/);
    if (!matched) invalid(`${path}.time_range`, "需为起止秒，如 0–1s");
    const start = Number(matched[1]);
    const end = Number(matched[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) invalid(path, "时段需为有限秒数");
  };
  for (const episode of project.episodes) {
    register(episode.id, "episodes.id");
    if (!Number.isInteger(episode.sequence) || episode.sequence < 1) invalid("episodes.sequence", "需为正整数");
    if (!Number.isInteger(episode.duration_seconds) || episode.duration_seconds < 1) invalid("episodes.duration_seconds", "需为正整数");
    if (!Number.isFinite(episode.actual_duration_seconds) || episode.actual_duration_seconds < 0) invalid("episodes.actual_duration_seconds", "需为非负秒数");
    for (const segment of episode.story_outline.segments) {
      if (!Number.isInteger(segment.sequence) || segment.sequence < 1) invalid("story_outline.segments.sequence", "需为正整数");
      if (!Number.isFinite(segment.duration_seconds) || segment.duration_seconds <= 0) invalid("story_outline.segments.duration_seconds", "需为有限正数");
    }
    const shotNumbers = new Set();
    for (const shot of episode.shot_list.shots) {
      register(shot.id, "episodes.shot_list.shots.id");
      if (!Number.isInteger(shot.sequence) || shot.sequence < 1) invalid("shots.sequence", "需为正整数");
      if (!shot.number || shotNumbers.has(shot.number)) invalid("shots.number", "重复或空编号");
      shotNumbers.add(shot.number);
      if (!Number.isInteger(shot.duration_seconds) || shot.duration_seconds < 1)
        invalid("shots.duration_seconds", "镜头时长需为正整数");
      if (!Number.isFinite(shot.actual_duration_seconds) || shot.actual_duration_seconds < 0)
        invalid("shots.actual_duration_seconds", "需为非负秒数");
      const bound = new Set();
      for (const appearing of shot.character_binding.on_screen_characters) {
        if (bound.has(appearing.character_id)) invalid("character_binding", "人物重复");
        bound.add(appearing.character_id);
        const character = characters.get(appearing.character_id);
        if (!character) invalid("shots.character_binding.on_screen_characters.character_id", "角色引用不存在");
        if (appearing.costume_id && costumes.get(appearing.costume_id) !== character.id)
          invalid("shots.character_binding.on_screen_characters.costume_id", "服装不属于该角色");
      }
      for (const beat of shot.seconds_storyboard.storyboard) {
        checkTimeRange(beat, "seconds_storyboard.storyboard");
        for (const line of beat.dialogue) {
          if (line.speaker_id && !characters.has(line.speaker_id)) invalid("dialogue.speaker_id", "角色引用不存在");
          assertEnum(line.mode, ["画内", "画外", "心声"], "dialogue.mode");
        }
      }
    }
  }
  return project;
}
