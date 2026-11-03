import {uid} from '../../shared/production/execution_support.js'
export const requireSourceCoverage=true
import {chapterRanges,upsert} from '../../../shared/text/source.js'
const baseAsset=(id,name,description)=>({id,name,description,image_ids:[],selected_image_id:null})
function planAssets(document,plan){
  const characters=plan.character_plans.map(row=>{const old=document.asset_library.characters.find(a=>a.character_plan_id===row.id)||document.asset_library.characters.find(a=>!a.character_plan_id&&a.name===row.name);return {...(old||baseAsset(uid('char'),row.name,row.description)),name:row.name,character_plan_id:row.id,voice_profile:old?.voice_profile||{description:'',reference_audio_ref:null,revision:0}}})
  const scenes=plan.scene_plans.map(row=>{const old=document.asset_library.scenes.find(a=>a.scene_plan_id===row.id)||document.asset_library.scenes.find(a=>!a.scene_plan_id&&a.name===row.name);return {...(old||baseAsset(uid('scene'),row.name,row.description)),name:row.name,scene_plan_id:row.id,layout:old?.layout||'',entrances:old?.entrances||'',landmarks:old?.landmarks||''}})
  document.asset_library.characters=upsert(document.asset_library.characters,characters);document.asset_library.scenes=upsert(document.asset_library.scenes,scenes)
}

export function applyCandidate(next,unit,output,files={}){
    if(['style','audience','adaptation_scope'].some(key=>!output.creative_constraints[key].trim()))throw new TypeError('全篇创作约束必须明确风格、受众和改编尺度')
    if(!output.plot_development.trim())throw new TypeError('请提供完整的全篇剧情发展规划')
    if(next.adaptation_plan.creative_constraints.locked_requirements.some(rule=>!output.creative_constraints.locked_requirements.includes(rule)))throw new TypeError('不能丢失既有锁定要求')
    if(next.source.current_revision_id){
      if(!output.character_plans.length)throw new TypeError('有原稿的联合改编必须提供主要人物规划，不能提交空的character_plans')
      if(!output.scene_plans.length)throw new TypeError('有原稿的联合改编必须提供关键场景规划，不能提交空的scene_plans')
    }
    next.adaptation_plan={...output,revision:next.adaptation_plan.revision+1,source_revision_id:next.source.current_revision_id}
    planAssets(next,next.adaptation_plan)

}
export async function prepareText(projects,project,input,{signal}={}){
 const id=project.basic_info.id,units=[];
    if(project.source.current_revision_id&&(project.node_states.source_analysis.status!=='confirmed'||project.source_analysis.source_revision_id!==project.source.current_revision_id))throw new TypeError('请先完成当前原稿的原著解析')
    if(input.unit_id&&input.unit_id!=='global')throw new TypeError('联合改编只生成全篇指导，不支持章节或段计划单元')
    units.push({id:uid('unit'),kind:'guidance',source_spans:chapterRanges(project.source_analysis.chapters,project.source.current_revision_id).map(({chapter_id,...range})=>range),material:{goal:input.instruction||project.node_states.adaptation_plan.opinion||'制定全篇创作约束与四类规划，确定关键事件因果链，供故事分段定稿执行',source_index_ref:'snapshot:/source_analysis/chapters',existing_guidance_ref:'snapshot:/adaptation_plan',instruction:'通读原著，形成全篇创作约束、全篇剧情发展、人物规划、团队规划、场景规划。剧情发展用连贯文本写清主线目标、因果推进、关键转折、高潮和结局方向，结合人物动机、团队关系与场景作用。覆盖主要人物、关键场景和实际相关团队，保留有效内容和稳定ID。故事分段定稿据此自主确定段落并展开完整正文。'}})

 if(input.unit_id&&units.length===0)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
  const {creative_constraints,plot_development,character_plans,scene_plans,group_plans}=project.adaptation_plan
  return {creative_constraints,plot_development,character_plans,scene_plans,group_plans}

}
export async function writeCandidateFiles(projects,projectId,output){const files={};;return files}
