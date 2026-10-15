import { previousShot } from './video-inputs.js';
import { invalid } from './task_contract.js';

export function characterTextCatalog(project) {
  return project.character_library.characters.map(({ number, name, gender, era, position, age_range, body_type, hairstyle, signature_props, immutable_traits, voice, costumes }) => ({
    number, name, gender, era, position, age_range, body_type, hairstyle, signature_props, immutable_traits, voice,
    costumes: costumes.map(({ number, name, color, material, props }) => ({ number, name, color, material, props })),
  }));
}
export function bindingNumbers(project, binding) {
  return { on_screen_characters: binding.on_screen_characters.map(row => {
    const person = project.character_library.characters.find(person => person.id === row.character_id);
    if (!person) invalid('绑定', '角色不存在');
    const costume = person.costumes.find(costume => costume.id === row.costume_id);
    if (row.costume_id && !costume) invalid('绑定', '服装不属于该角色');
    return { character_number: person.number, costume_number: costume?.number || '' };
  }) };
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
      .map(beat => ({ ...structuredClone(beat), dialogue: beat.dialogue.map(line => ({ ...line, speaker_id: '' })) })) };
}
// 整镜设定只有镜头表一份来源；输入与UI按需投影，不复制到每秒节点保存。
export function shotSceneSetup(shot) {
  return Object.fromEntries(['body', 'shot_scale', 'continuity_transition', 'reference_anchor', 'audio_arrangement']
    .map(key => [key, structuredClone(shot[key])]));
}
export function shotTextInputs(project, episode, shot, business) {
  const fields = ['title', 'number', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement'];
  const table = Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])]));
  const characters = characterTextCatalog(project);
  if (business === 'shot-characters') {
    const shots = [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence);
    const previous = shots[shots.findIndex(row => row.id === shot.id) - 1];
    return { shot: table, characters, previous: previous?.character_binding.node_state.status === 'generated' && previous.character_binding.on_screen_characters.length > 0
      ? { shot: previous.number, ...bindingNumbers(project, previous.character_binding) } : '' };
  }
  if (business === 'seconds') return { shot: table, characters, previous: previousSeconds(episode, shot), bindings: bindingNumbers(project, shot.character_binding).on_screen_characters };
  const speakers = new Set(shot.seconds_storyboard.storyboard.flatMap(beat => beat.dialogue.map(line => line.speaker_name)));
  const speakerIds = new Set(shot.seconds_storyboard.storyboard.flatMap(beat => beat.dialogue.map(line => line.speaker_id)).filter(Boolean));
  const visible = new Set(shot.character_binding.on_screen_characters.map(row => project.character_library.characters.find(person => person.id === row.character_id)?.number));
  const participants = characters.flatMap((person, index) => {
    const source = project.character_library.characters[index];
    return speakers.has(person.name) || speakerIds.has(source.id) || visible.has(person.number)
      ? [{ ...person, nationality: source.nationality, height: source.height, facial_features: source.facial_features }] : [];
  });
  return { duration: shot.duration_seconds, characters: participants,
    storyboard: { shot_setup: shotSceneSetup(shot), ...secondsEnding(shot.seconds_storyboard), storyboard: shot.seconds_storyboard.storyboard.map(beat => ({ ...structuredClone(beat), dialogue: beat.dialogue.map(line => ({ ...line, speaker_id: '' })) })) } };
}
