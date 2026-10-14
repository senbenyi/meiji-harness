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
  if (business === 'seconds') return { shot: table, characters, bindings: bindingNumbers(project, shot.character_binding).on_screen_characters };
  const speakers = new Set(shot.seconds_storyboard.storyboard.flatMap(beat => beat.dialogue.map(line => line.speaker_name)));
  const visible = new Set(shot.character_binding.on_screen_characters.map(row => project.character_library.characters.find(person => person.id === row.character_id)?.number));
  return { duration: shot.duration_seconds, characters: characters.filter(person => speakers.has(person.name) || visible.has(person.number)),
    storyboard: { storyboard: shot.seconds_storyboard.storyboard.map(beat => ({ ...structuredClone(beat), dialogue: beat.dialogue.map(line => ({ ...line, speaker_id: '' })) })) } };
}
