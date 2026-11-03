import {mediaMemory} from '../../../memory/service.js'
import {UnitProductionExecutor} from '../../shared/production/unit_executor.js'
import {uid,readJSON} from '../../shared/production/execution_support.js'
import {findAsset,requiredAssets,preparationState} from './assets.js'
import {actionRules} from '../../shared/agent/rules.js'

/** 图片盒子：需求选择、参考组合、调用图片模型、立即入库，等待人工选用。 */
export class ImageProductionExecutor extends UnitProductionExecutor {
  constructor(service){super(service,['asset_preparation'])}
  async createUnits(_ctx,project,input){
    if(project.node_states.shot_design.status!=='confirmed')throw new TypeError('请先确认文字分镜与需求')
    return (input.target_id?[findAsset(project,input.target_id)]:requiredAssets(project)).filter(({asset})=>(!input.target_id||asset.id===input.target_id)&&(input.regenerate||!asset.selected_image_id&&!asset.image_ids.length)).map(({asset})=>({id:uid('unit'),target_id:asset.id,image_id:uid('img'),operation_id:uid('op')}))
  }
  async finish(ctx){
    const id=ctx.task.metadata.project_id
    const project=await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();Object.assign(p.node_states.asset_preparation,preparationState(p));if(p.node_states.asset_preparation.status==='confirmed')p.node_states.asset_preparation.opinion='';return p})
    this.service.notify(ctx.task)
    return {result:{saved:true,stage:'asset_preparation',status:project.node_states.asset_preparation.status,requires_confirmation:false}}
  }
  async executeUnit(ctx){
    const unit=await readJSON(this.projects,ctx.task.metadata.project_id,ctx.step.metadata.unit_ref)
    const service=this.service,{projects,images,models}=service,id=ctx.task.metadata.project_id,project=await projects.documents.read(id),{kind,asset}=findAsset(project,unit.target_id),config=await models.read(),references=[]
    const referenceIds=[]
    if(kind==='character_looks'){
      for(const target of [asset.character_id,...asset.clothing_ids,...asset.prop_ids]){const found=findAsset(project,target).asset;if(found.selected_image_id&&!referenceIds.includes(found.selected_image_id))referenceIds.push(found.selected_image_id)}
    }
    if(referenceIds.length>5)throw new TypeError('组合定妆参考超过图片模型5张上限，请选择合成参考或减少本次组合')
    if(referenceIds.length&&config.image.model!=='gpt-image')throw new TypeError('当前图片模型不支持参考图，请选择GPT Image生成组合定妆')
    for(const imageId of referenceIds)references.push({bytes:await images.read(imageId),mime:'image/png'})
    const related=kind==='character_looks'?[asset.character_id,...asset.clothing_ids,...asset.prop_ids].map(target=>findAsset(project,target).asset):[]
    const remembered=await mediaMemory(projects,ctx.task)
    const prompt=[remembered,await actionRules('asset_preparation','generate',project.node_states.asset_preparation.rules.generate),`目标类型:${kind}\n${JSON.stringify(asset)}`,`组合定义:${JSON.stringify(related)}`,`参考图顺序与用途:${JSON.stringify(referenceIds.map((image_id,index)=>({reference:index+1,image_id,subjects:related.filter(a=>a.selected_image_id===image_id).map(a=>({id:a.id,name:a.name,kind:findAsset(project,a.id).kind}))})))}`,ctx.task.metadata.instruction].filter(Boolean).join('\n\n')
    const inputRef=await projects.documents.writeArtifact(id,JSON.stringify({memory_snapshot_ref:ctx.task.metadata.memory_snapshot_ref||null,prompt,reference_image_ids:referenceIds,model:config.image.model}),{extension:'json'})
    ctx.recordPrompt({model:config.image.model,messages:[{role:'user',content:JSON.stringify({input_ref:inputRef})}],input:{input_ref:inputRef,target_id:asset.id,reference_image_ids:referenceIds}})
    let image
    try{image=images.get(unit.image_id)}catch(error){if(error.code!=='ENOENT')throw error}
    if(!image){const bytes=await models.generateImage({prompt,aspectRatio:project.basic_info.aspect_ratio,references,requestId:unit.operation_id,signal:ctx.signal,record:service.recorder(ctx)});image=await images.put(bytes,{id:unit.image_id,signal:ctx.signal})}
    await projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();const target=findAsset(p,asset.id).asset;if(!target.image_ids.includes(image.id))target.image_ids.push(image.id);p.node_states.asset_preparation.product_revision++;p.node_states.asset_preparation.status='partial';p.node_states.asset_preparation.reason='图片已生成并入库';return p})
    return this.acceptUnit(ctx,{saved:true,image_id:image.id,target_id:asset.id,input_ref:inputRef})
  }
}
