import { shotScene } from './scene-inputs.js';
import { previousShot } from './video-inputs.js';

export function characterTextCatalog(project) {
  return project.character_library.characters.map(({ id, name, gender, era, position, age_range, body_type, hairstyle, signature_props, immutable_traits, voice, costumes }) => ({
    id, name, gender, era, position, age_range, body_type, hairstyle, signature_props, immutable_traits, voice,
    costumes: costumes.map(({ id, name, description, color, material, props }) => ({ id, name, description, color, material, props })),
  }));
}
// 前镜资料直接取已保存的镜末字段和完整末尾节拍，不让模型二次摘要。
export function secondsEnding(node) {
  return { end_state: node.end_state, pending_actions: node.pending_actions,
    pending_dialogue: node.pending_dialogue, continuing_audio: node.continuing_audio };
}
export function previousSeconds(episode, shot) {
  const previous = previousShot(episode, shot);
  if (!previous) return null;
  const node = previous.seconds_storyboard, beats = node.storyboard;
  const end = beats.length ? Number(beats.at(-1).time_range.split(/[–-]/)[1].replace('s', '')) : 0;
  return { shot_number: previous.number, ...secondsEnding(node),
    last_beats: beats.filter(beat => Number(beat.time_range.split(/[–-]/)[1].replace('s', '')) > end - 3)
      .map(beat => structuredClone(beat)) };
}
// 整镜设定只有镜头表一份来源；输入与UI按需投影，不复制到每秒节点保存。
export function shotSceneSetup(shot) {
  return Object.fromEntries(['body', 'shot_scale', 'continuity_transition', 'reference_anchor', 'audio_arrangement']
    .map(key => [key, structuredClone(shot[key])]));
}
export function shotTextInputs(project, episode, shot, business) {
  const fields = ['title', 'number', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];
  const table = Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])]));
  const scene = shotScene(project, shot);
  if (scene) { table.scene = scene; table.scene_transition = shot.scene_transition; }
  const characters = characterTextCatalog(project);
  if (business === 'seconds') return { shot: table, characters, previous: previousSeconds(episode, shot) };
  const speakerIds = new Set(shot.seconds_storyboard.storyboard.flatMap(beat => beat.dialogue.map(line => line.speaker_id)).filter(Boolean));
  const visible = new Set(shot.on_screen_characters.map(row => row.character_id));
  // 使用完整目录生成跨镜统一标记；不按本镜子集重新编号，目录重排也不改变编号。
  const speakerTags = new Map([...characters].sort((a, b) => a.id.localeCompare(b.id))
    .map((person, index) => [person.id, `(S${index + 1})`]));
  const participants = characters.flatMap((person, index) => {
    const source = project.character_library.characters[index];
    return speakerIds.has(person.id) || visible.has(person.id)
      ? [{ ...person, speaker_tag: speakerTags.get(person.id), nationality: source.nationality, height: source.height, facial_features: source.facial_features }] : [];
  });
  return { duration: shot.duration_seconds, characters: participants,
    storyboard: { on_screen_characters: structuredClone(shot.on_screen_characters), background_characters: shot.background_characters, shot_setup: { ...shotSceneSetup(shot), ...(scene ? { scene, scene_transition: shot.scene_transition } : {}) }, ...secondsEnding(shot.seconds_storyboard), storyboard: shot.seconds_storyboard.storyboard.map(beat => structuredClone(beat)) } };
}
