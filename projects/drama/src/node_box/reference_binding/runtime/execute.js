import {bindReferences} from './pipeline.js'

export async function executeUnit(ctx){
  const id=ctx.task.metadata.project_id
  const project=await this.projects.documents.mutate(id,p=>{
    ctx.signal.throwIfAborted()
    if(p.node_states.asset_preparation.status!=='confirmed')throw new TypeError('请先完成素材图片生成')
    const bound=bindReferences(p)
    bound.node_states.shot_design.product_revision++;bound.node_states.reference_binding.product_revision++
    return bound
  })
  return {saved:true,shots:project.shot_design.shots.length}
}
