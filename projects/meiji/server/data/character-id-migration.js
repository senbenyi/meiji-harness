import { migrateShotCast } from './shot-cast-migration.js';
import { stampDependencyHash } from '../../shared/node-dependencies.js';

// v19：保留原有ID和引用，仅移除角色/服装的第二套身份。
export function removeCharacterNumbers(project) {
  for (const character of project.character_library.characters) {
    delete character.number;
    for (const costume of character.costumes) delete costume.number;
  }
  return project;
}

export function migrateCharacterIds(project) {
  migrateShotCast(removeCharacterNumbers(project));
  const snapshot = { project, tasks: [], steps: [] };
  const stamp = (business, id, node) => {
    if (node.node_state.status === 'generated') stampDependencyHash(snapshot, business, id);
  };
  for (const episode of project.episodes) {
    stamp('shots', episode.id, episode.shot_list);
    for (const shot of [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence)) {
      for (const [business, key] of [['seconds', 'seconds_storyboard'], ['storyboard', 'text_to_video_prompt'], ['first-last-frame', 'first_last_frame_prompt'], ['multimodal', 'multimodal_prompt'], ['video', 'video'], ['tail', 'last_frame']])
        stamp(business, shot.id, shot[key]);
    }
    stamp('assembly', episode.id, episode.assembly);
  }
}
