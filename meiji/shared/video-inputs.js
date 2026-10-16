// 镜头表出镜绑定决定类型，缺图不改变类型。
export function previousShot(episode, shot) {
  const shots = [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence);
  return shots[shots.findIndex(item => item.id === shot.id) - 1] || null;
}
export function videoType(episode, shot) {
  return shot.on_screen_characters.length ? '多模态' : previousShot(episode, shot) ? '首尾帧' : '文生';
}
export const videoPack = type => ({ '首尾帧': 'first-last-frame', '多模态': 'multimodal' }[type] || null);
export function videoImages(project, shot) {
  return shot.on_screen_characters.map(row => {
    const person = project.character_library.characters.find(person => person.id === row.character_id);
    return { id: row.costume_id || person.id, image: person.costume_images.find(image => image.costume_id === row.costume_id) };
  });
}
