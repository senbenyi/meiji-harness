import { hasNodeContent } from '../../shared/node-state.js';
import { dependencyHash } from '../../shared/node-dependencies.js';

// v15：只迁移当前节点及未结束任务的入队快照，历史任务终态/结果不改。
export function migrateNodeDataStates(snapshot) {
  const {project,tasks}=snapshot;
  const apply=(business,id,node)=>{
    const state=node.node_state;
    if (!['empty','generated','rejected','expired'].includes(state.status)) {
      const history=tasks.filter(t=>t.business_type===business&&t.target_id===id).sort((a,b)=>b.queue_order-a.queue_order);
      let previous;
      for(const task of history){
        if(['completed','rejected'].includes(task.task_status)) {
          previous={status:task.task_status==='completed'?'generated':'rejected',reason:task.end_reason||''};break;
        }
        if(['empty','generated','rejected','expired'].includes(task.previous_node_state?.status)) {previous=task.previous_node_state;break;}
      }
      if(!hasNodeContent(project,business,id)) Object.assign(state,{status:'empty',reason:''});
      else if(previous?.status==='rejected') Object.assign(state,{status:'rejected',reason:previous.reason||'历史审核未通过'});
      else if(previous?.status==='expired') Object.assign(state,{status:'expired',reason:previous.reason||'历史数据已过期'});
      else {
        const current=Boolean(state.dependency_hash)&&state.dependency_hash===dependencyHash(snapshot,business,id);
        Object.assign(state,{status:current?'generated':'expired',reason:current?'':'历史数据有效性需重新确认'});
      }
    }
    state.fail_message='';
    for(const task of tasks) if(task.business_type===business&&task.target_id===id&&['queued','running'].includes(task.task_status))
      task.previous_node_state={status:state.status,reason:state.reason,fail_message:''};
  };
  apply('project-summary',project.id,project.project_summary);
  apply('project-characters',project.id,project.character_library);
  for(const c of project.character_library.characters) for(const image of c.costume_images)
    apply('costume-image',image.costume_id||c.id,image);
  for(const e of project.episodes){
    for(const [b,key] of [['episode-summary','summary'],['outline','story_outline'],['shots','shot_list'],['assembly','assembly']])apply(b,e.id,e[key]);
    for(const shot of e.shot_list.shots) for(const [b,key] of [['seconds','seconds_storyboard'],['storyboard','text_to_video_prompt'],['first-last-frame','first_last_frame_prompt'],['multimodal','multimodal_prompt'],['video','video'],['tail','last_frame']])apply(b,shot.id,shot[key]);
  }
}
