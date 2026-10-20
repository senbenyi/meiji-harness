import { dependencyHash } from '../../shared/node-dependencies.js';

// 仅由存储版本迁移调用，旧像素画幅不作为运行时输入接受。
export function migrateAspectRatio(project) {
  const ratio = { '1344x768':'16:9', '768x1344':'9:16' }[project.basic_info.aspect_ratio];
  if (!ratio) return project;
  const snapshot = { project, tasks:[], steps:[] }, current=[];
  const remember=(business,id,node)=>{
    if (node.node_state.status==='generated' && node.node_state.dependency_hash===dependencyHash(snapshot,business,id)) current.push([business,id,node]);
  };
  for (const e of project.episodes) {
    for (const s of e.shot_list.shots) {
      remember('first-last-frame',s.id,s.first_last_frame_prompt);
      remember('multimodal',s.id,s.multimodal_prompt);
      remember('video',s.id,s.video);
      remember('tail',s.id,s.last_frame);
    }
    remember('assembly',e.id,e.assembly);
  }
  project.basic_info.aspect_ratio=ratio;
  // 按编排→视频→尾帧→合片的依赖顺序重算原本有效的指纹。
  for (const [business,id,node] of current) node.node_state.dependency_hash=dependencyHash(snapshot,business,id);
  return project;
}
