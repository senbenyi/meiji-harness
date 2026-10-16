import test from "node:test";
import assert from "node:assert/strict";
import { emptyProjectModel } from "../shared/models/project_model.js";
import { emptyEpisodeModel } from "../shared/models/episode_model.js";
import { emptyShotModel } from "../shared/models/shot_model.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { emptyCostumeModel } from "../shared/models/costume_model.js";
import { emptyCostumeImageModel } from "../shared/models/costume_image_model.js";
import { emptyStorySegmentModel } from "../shared/models/story_segment_model.js";
import { emptyOnScreenCharacterModel } from "../shared/models/on_screen_character_model.js";
import { emptyStoryboardBeatModel } from "../shared/models/storyboard_beat_model.js";
import { emptyDialogueModel } from "../shared/models/dialogue_model.js";
import { emptyReferenceImageModel } from "../shared/models/reference_image_model.js";
import { validateProject } from "../shared/project_contract.js";
import { createTaskGroupModel } from "../shared/models/task_group_model.js";
import { createTaskModel } from "../shared/models/task_model.js";
import { createStepModel } from "../shared/models/step_model.js";

test("项目模型的每个嵌套数组项都由独立模型构造并通过完整结构校验", () => {
  const project = emptyProjectModel();
  const character = emptyCharacterModel({ name: "角色" });
  const costume = emptyCostumeModel({ name: "常服" });
  character.costumes.push(costume);
  character.default_costume_id = costume.id;
  character.costume_images.push(emptyCostumeImageModel(costume.id));
  project.character_library.characters.push(character);

  const episode = emptyEpisodeModel();
  episode.story_outline.segments.push(emptyStorySegmentModel());
  const shot = emptyShotModel();
  shot.on_screen_characters.push(emptyOnScreenCharacterModel({ character_id: character.id, costume_id: costume.id }));
  const beat = emptyStoryboardBeatModel();
  beat.time_range = "0–1s";
  beat.dialogue.push(emptyDialogueModel());
  shot.seconds_storyboard.storyboard.push(beat);
  shot.multimodal_prompt.reference_images.push(emptyReferenceImageModel());
  episode.shot_list.shots.push(shot);
  project.episodes.push(episode);

  assert.equal(validateProject(project), project);
});

test("任务组、任务和步骤固定字段模型均为英文 snake_case", () => {
  const group = createTaskGroupModel();
  const task = createTaskModel();
  const step = createStepModel();
  assert.deepEqual(Object.keys(group), ["id", "project_id", "episode_id", "name", "group_type", "action", "source", "shot_ids", "created_at"]);
  assert.deepEqual(Object.keys(task), ["id", "project_id", "episode_id", "business_type", "target_id", "action", "group_id", "group_seq", "task_status", "source", "name", "queue_order", "end_reason", "created_at", "started_at", "ended_at", "opinion", "previous_node_state"]);
  assert.deepEqual(Object.keys(step), ["id", "task_id", "name", "seq", "kind", "round", "step_status", "error_reason", "prompt", "result", "started_at", "ended_at"]);
});
