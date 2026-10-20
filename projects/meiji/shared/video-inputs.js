// 只使用对应人物服装和场景的可用参考图；缺图时由实际素材决定视频类型。
export function previousShot(episode, shot) {
  const shots = [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence);
  return shots[shots.findIndex(item => item.id === shot.id) - 1] || null;
}
// 逻辑连续关系独立于素材有效性，用于选择及失效后的依赖传播。
export function continuousPreviousShot(episode, shot) {
  const previous=previousShot(episode,shot);
  return previous && shot.scene_transition === '连续接拍' && shot.scene_id === previous.scene_id && shot.scene_state === previous.scene_state ? previous : null;
}
function validContinuityFrame(episode, shot) {
  const previous=continuousPreviousShot(episode,shot);
  return previous?.video.node_state.status === 'generated' && previous.last_frame.address && previous.last_frame.node_state.status === 'generated' ? previous : null;
}
export function videoType(project, episode, shot) {
  if (videoImages(project, shot).length) return '多模态';
  return validContinuityFrame(episode,shot) ? '首尾帧' : '文生';
}
export const videoPack = type => ({ '首尾帧': 'first-last-frame', '多模态': 'multimodal' }[type] || null);
export function videoImages(project, shot) {
  const images = shot.on_screen_characters.map(row => {
    const person = project.character_library.characters.find(person => person.id === row.character_id);
    return { kind:'character', business_type:'costume-image', id: row.costume_id || person.id, image: person.costume_images.find(image => image.costume_id === row.costume_id) };
  });
  if (shot.scene_id) {
    const scene = project.scene_library.scenes.find(item => item.id === shot.scene_id);
    images.push({kind:'scene',business_type:'scene-image',id:shot.scene_id,image:scene?.reference_image,scene});
  }
  const selected=images.filter(({ image }) => image?.address && image.node_state.status === 'generated');
  const episode=project.episodes.find(episode=>episode.shot_list.shots.some(item=>item.id===shot.id));
  const previous=episode && validContinuityFrame(episode,shot);
  if (selected.length && previous) selected.push({kind:'continuity',business_type:'tail',id:previous.id,image:previous.last_frame,shot:previous});
  return selected;
}

// 直接传递原节拍声音安排；不从自由文本推算时间，也不再次复制台词。
export function videoSpeechTiming(shot) {
  return shot.seconds_storyboard.storyboard.filter(beat=>beat.dialogue.length).map(beat=>({
    time_range:beat.time_range, audio:beat.audio,
    speakers:[...new Set(beat.dialogue.map(line=>line.speaker_name).filter(Boolean))],
  }));
}
