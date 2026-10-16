import { emptySceneModel } from './models/scene_model.js';
import { invalid } from './task_contract.js';
export const sceneFields = ['id', 'name', 'description', 'layout', 'materials', 'lighting'];
export const sceneText = scene => Object.fromEntries(sceneFields.map(key => [key, scene[key]]));
export const sceneCatalog = (project, episode) => project.scene_library.scenes
  .filter(scene => !episode || episode.scene_catalog.scene_ids.includes(scene.id)).map(sceneText);
export function shotScene(project, shot) {
  const scene = project.scene_library.scenes.find(scene => scene.id === shot.scene_id);
  return scene ? { ...sceneText(scene), state: shot.scene_state } : null;
}
// 未返回的旧场景不删除；同名复用，别名由模型明确引用已有ID。
export function mergeScenes(project, rows) {
  if (!Array.isArray(rows)) invalid('场景', '需为数组');
  const scenes = structuredClone(project.scene_library.scenes), scene_ids = [], seenNames = new Set();
  for (const row of rows) {
    if (!row.name.trim() || seenNames.has(row.name.trim())) invalid('场景.name', '名称为空或重复，请合并同一地点');
    seenNames.add(row.name.trim());
    const byId = row.id ? scenes.find(scene => scene.id === row.id) : null;
    if (row.id && !byId) invalid('场景.id', '只能复用项目已有ID，新增场景ID为空');
    const named = scenes.filter(scene => scene.name.trim() === row.name.trim());
    if (!byId && named.length > 1) invalid('场景.name', '同名场景不唯一，请明确已有ID');
    const scene = byId || named[0] || emptySceneModel();
    if (scene_ids.includes(scene.id)) invalid('场景', '同一地点重复返回，请合并');
    if (!scenes.some(item => item.id === scene.id)) scenes.push(scene);
    for (const key of sceneFields.filter(key => key !== 'id')) scene[key] = row[key].trim();
    scene_ids.push(scene.id);
  }
  return { scenes, scene_ids };
}
