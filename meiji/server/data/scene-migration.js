import { emptySceneCatalogModel } from '../../shared/models/scene_model.js';
export function migrateScenes(project) {
  project.scene_library ??= { scenes: [] };
  const expire = node => {
    if (node?.node_state.status === 'generated') Object.assign(node.node_state, { status: 'expired', reason: '请先提取场景并重新生成带场景绑定的镜头表', fail_message: '' });
  };
  for (const episode of project.episodes) {
    episode.scene_catalog ??= emptySceneCatalogModel();
    let changed = false;
    for (const shot of episode.shot_list.shots) {
      if (Object.hasOwn(shot, 'scene_id')) continue;
      Object.assign(shot, { scene_id: '', scene_state: '', scene_transition: '切换机位' });
      changed = true;
      for (const key of ['seconds_storyboard', 'text_to_video_prompt', 'first_last_frame_prompt', 'multimodal_prompt', 'video', 'last_frame']) expire(shot[key]);
    }
    if (changed) { expire(episode.shot_list); expire(episode.assembly); }
  }
  return project;
}
