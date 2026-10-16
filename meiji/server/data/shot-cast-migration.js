// v20：独立识别绑定并入镜头表；不猜测旧正文里的群演和服装选择。
export function migrateShotCast(project) {
  const expire = node => {
    if (node.node_state.status === 'generated') Object.assign(node.node_state, {
      status: 'expired', reason: '出镜人物与服装已并入镜头表，请重新生成镜头表',
    });
  };
  for (const episode of project.episodes) {
    let changed = false;
    for (const shot of episode.shot_list.shots) {
      if (!Object.hasOwn(shot, 'character_binding')) continue;
      shot.on_screen_characters = structuredClone(shot.character_binding.on_screen_characters);
      shot.background_characters = '';
      delete shot.character_binding;
      changed = true;
      for (const key of ['seconds_storyboard', 'text_to_video_prompt', 'first_last_frame_prompt', 'multimodal_prompt', 'video', 'last_frame']) expire(shot[key]);
    }
    if (changed) { expire(episode.shot_list); expire(episode.assembly); }
  }
  return project;
}
