import {arrangeClips} from './pipeline.js'

export async function executeUnit(ctx){const id=ctx.task.metadata.project_id;let project=await this.projects.documents.read(id),result;
      if(project.node_states.reference_binding.status!=='confirmed')throw new TypeError('请先确认分镜参考')
      const clips=arrangeClips(project);await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.clip_arrangement.clips=clips;p.node_states.clip_arrangement.product_revision++;return p});result={saved:true,clips:clips.length}
    
return result
}
