import {uid} from '../../production/execution_support.js'
export const requireSourceCoverage=true
import {chapterRanges,upsert} from '../../production/source.js'
const baseAsset=(id,name,description)=>({id,name,description,image_ids:[],selected_image_id:null})
function planAssets(document,plan){
  const characters=plan.character_plans.map(row=>{const old=document.asset_library.characters.find(a=>a.character_plan_id===row.id)||document.asset_library.characters.find(a=>!a.character_plan_id&&a.name===row.name);return {...(old||baseAsset(uid('char'),row.name,row.description)),name:row.name,character_plan_id:row.id,voice_profile:old?.voice_profile||{description:'',reference_audio_ref:null,revision:0}}})
  const scenes=plan.scene_plans.map(row=>{const old=document.asset_library.scenes.find(a=>a.scene_plan_id===row.id)||document.asset_library.scenes.find(a=>!a.scene_plan_id&&a.name===row.name);return {...(old||baseAsset(uid('scene'),row.name,row.description)),name:row.name,scene_plan_id:row.id,layout:old?.layout||'',entrances:old?.entrances||'',landmarks:old?.landmarks||''}})
  document.asset_library.characters=upsert(document.asset_library.characters,characters);document.asset_library.scenes=upsert(document.asset_library.scenes,scenes)
}

export function applyCandidate(next,unit,output,files={}){
    if(!output.goal.trim()||output.goal.trim()===next.basic_info.name.trim())throw new TypeError('改编目标与原则必须说明创作方向，不能直接使用项目名称；请写清风格、受众、改编尺度、保留与允许调整的内容')
    if(next.adaptation_plan.locked_requirements.some(rule=>!output.locked_requirements.includes(rule)))throw new TypeError('不能丢失既有锁定要求')
    next.adaptation_plan={...output,revision:next.adaptation_plan.revision+1,source_revision_id:next.source.current_revision_id}
    planAssets(next,next.adaptation_plan)

}
export async function prepareText(projects,project,input,{signal}={}){
 const id=project.basic_info.id,units=[];
    if(project.source.current_revision_id&&(project.node_states.source_analysis.status!=='confirmed'||project.source_analysis.source_revision_id!==project.source.current_revision_id))throw new TypeError('请先完成当前原稿的原著解析')
    if(input.unit_id&&input.unit_id!=='global')throw new TypeError('联合改编只生成全篇指导，不支持章节或段计划单元')
    units.push({id:uid('unit'),kind:'guidance',source_spans:chapterRanges(project.source_analysis.chapters,project.source.current_revision_id).map(({chapter_id,...range})=>range),material:{goal:input.instruction||project.node_states.adaptation_plan.opinion||'结合原著和适用用户要求，形成视频改编的全篇目标与原则及剧情方向；项目名称不代表改编目标',source_index_ref:'snapshot:/source_analysis/chapters',existing_guidance_ref:'snapshot:/adaptation_plan',instruction:'读取全部原著正文，goal写明风格、受众、改编尺度、保留内容和允许调整内容；用户未指定时依据原著自主作出明确方案选择，直接写成可执行原则，不写建议或待确认；方案选择不冒充用户已确认要求，不自动加入locked_requirements或用户偏好记忆，不将项目名当目标。保留原著事实边界。plot_text只写主线冲突与强化方向、人物动机关系成长、场景作用和团队指导。不预先切故事段，不安排逐段事件或衔接，不写定稿正文，不提前设计声线或制服版本。已有稳定人物/场景/团队ID应复用。'}})

 if(input.unit_id&&units.length===0)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
  const {goal,locked_requirements,plot_text,character_plans,scene_plans,group_plans}=project.adaptation_plan
  return {goal,locked_requirements,plot_text,character_plans,scene_plans,group_plans}

}
export async function writeCandidateFiles(projects,projectId,output){const files={};;return files}
