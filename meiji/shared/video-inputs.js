// 镜头表出镜绑定决定类型，缺图不改变类型。
export function previousShot(episode, shot) {
  const shots = [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence);
  return shots[shots.findIndex(item => item.id === shot.id) - 1] || null;
}
export function videoType(episode, shot) {
  const previous = previousShot(episode,shot);
  if (shot.on_screen_characters.length) return '多模态';
  if (previous && shot.scene_transition === '连续接拍' && shot.scene_id === previous.scene_id && shot.scene_state === previous.scene_state) return '首尾帧';
  return shot.scene_id ? '多模态' : '文生';
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
  return images;
}
