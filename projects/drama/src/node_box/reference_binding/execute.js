import {bindReferences} from './pipeline.js'

export async function executeUnit(ctx){const id=ctx.task.metadata.project_id;let project=await this.projects.documents.read(id),result;
      if(project.node_states.asset_preparation.status!=='confirmed')throw new TypeError('请先人工选用并确认素材')
      const bound=bindReferences(project);await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.shot_design=bound.shot_design;p.node_states.shot_design.product_revision++;p.node_states.reference_binding.product_revision++;return p});result={saved:true,shots:bound.shot_design.shots.length}
    
return result
}
