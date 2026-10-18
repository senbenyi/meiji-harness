// 只使用对应人物服装和场景的可用参考图；缺图时由实际素材决定视频类型。
export function previousShot(episode, shot) {
  const shots = [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence);
  return shots[shots.findIndex(item => item.id === shot.id) - 1] || null;
}
export function videoType(project, episode, shot) {
  if (videoImages(project, shot).length) return '多模态';
  const previous = previousShot(episode, shot);
  if (previous && shot.scene_transition === '连续接拍' && shot.scene_id === previous.scene_id && shot.scene_state === previous.scene_state
      && previous.last_frame.address && previous.last_frame.node_state.status === 'generated') return '首尾帧';
  return '文生';
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
  return images.filter(({ image }) => image?.address && image.node_state.status === 'generated');
}
