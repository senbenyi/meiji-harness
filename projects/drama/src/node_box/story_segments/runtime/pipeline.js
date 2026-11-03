import {uid} from '../../shared/production/execution_support.js'
import {chapterRanges,upsert} from '../../../shared/text/source.js'
export const requireSourceCoverage=true

export function applyCandidate(next,unit,output,files={}){
  if(unit.kind==='story_audit'){
    if(output.segments.length!==unit.segment_ids.length||new Set(output.segments.map(s=>s.id)).size!==unit.segment_ids.length||output.segments.some((s,index)=>s.id!==unit.segment_ids[index]))throw new TypeError('全篇衔接修订只能且必须按顺序返回当前两段，保留稳定ID')
    for(const item of output.segments){const old=next.story_segments.segments.find(s=>s.id===item.id);next.story_segments.segments=upsert(next.story_segments.segments,[{...old,title:item.title,revision:old.revision+1,body_ref:files[item.id]?.body_ref||old.body_ref,continuity_ref:files[item.id]?.continuity_ref||old.continuity_ref}])}
  }else{
    if(!output.segments.length||new Set(output.segments.map(row=>row.id)).size!==output.segments.length)throw new TypeError('故事段必须非空且ID不能重复')
    const existing=next.story_segments.segments
    next.story_segments.segments=output.segments.map((item,index)=>{
      const old=existing.find(segment=>segment.id===item.id)
      return {id:item.id,sequence:index+1,revision:(old?.revision||0)+1,adaptation_revision:unit.adaptation_revision,title:item.title,body_ref:files[item.id]?.body_ref||old?.body_ref||'artifacts/dry-run.txt',continuity_ref:files[item.id]?.continuity_ref||old?.continuity_ref||null}
    })
  }
}
export async function prepareText(projects,project,input){
  if(project.node_states.adaptation_plan.status!=='confirmed'||!project.adaptation_plan.plot_development.trim())throw new TypeError('请先确认全篇联合改编指导')
  if(project.adaptation_plan.source_revision_id!==project.source.current_revision_id)throw new TypeError('请先按当前原稿更新全篇联合改编指导')
  if(project.source.current_revision_id&&(project.node_states.source_analysis.status!=='confirmed'||project.source_analysis.source_revision_id!==project.source.current_revision_id))throw new TypeError('请先完成当前原稿的原著解析')
  if(input.unit_id&&input.unit_id!=='story')throw new TypeError('故事分段定稿只生成全篇故事，请使用story单元')
  const guidance_ref=await projects.documents.writeArtifact(project.basic_info.id,JSON.stringify(project.adaptation_plan),{extension:'json'})
  return [{id:uid('unit'),kind:'story',source_spans:chapterRanges(project.source_analysis.chapters,project.source.current_revision_id).map(({chapter_id,...range})=>range),adaptation_revision:project.adaptation_plan.revision,read_refs:[guidance_ref],material:{guidance_ref,existing_segments:project.story_segments.segments,instruction:'完整阅读原剧本，按照冻结的联合改编规划创作改编后的完整故事剧本，自主确定全篇叙事分段。正文详细、完整、有观赏性，每段展开具体行动、角色反应、自然对白与必要场景细节，体现冲突递进、情感变化和节奏起伏。故事正文可独立阅读，各段共同构成从开端到结局的完整故事。以continuity记录改编后各段的开场和结尾状态；修改沿用已有稳定段ID。'}}]
}
export async function currentCandidate(projects,projectId,unit,project){
  const segments=[...project.story_segments.segments].sort((a,b)=>a.sequence-b.sequence)
  if(!segments.length)throw new TypeError('尚无可修改故事正文，请先生成')
  return {segments:await Promise.all(segments.map(async segment=>({id:segment.id,title:segment.title,body:(await projects.documents.readArtifact(projectId,segment.body_ref)).toString(),continuity:segment.continuity_ref?(await projects.documents.readArtifact(projectId,segment.continuity_ref)).toString():''})))}
}
export async function writeCandidateFiles(projects,projectId,output){const files={};for(const segment of output.segments)files[segment.id]={body_ref:await projects.documents.writeArtifact(projectId,segment.body),continuity_ref:await projects.documents.writeArtifact(projectId,segment.continuity)};return files}
