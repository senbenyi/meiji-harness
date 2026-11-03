import {uid} from '../../shared/production/execution_support.js'
export const requireSourceCoverage=true
import {chapterRanges,upsert} from '../../../shared/text/source.js'
const inStoryUnit=(segment,unit)=>unit.source_chapter_ids.length?segment.source_chapter_ids.some(id=>unit.source_chapter_ids.includes(id)):!segment.source_chapter_ids.length

export function applyCandidate(next,unit,output,files={}){if(unit.kind==='story_audit'){
    if(output.segments.length!==unit.segment_ids.length||new Set(output.segments.map(s=>s.id)).size!==unit.segment_ids.length||output.segments.some(s=>!unit.segment_ids.includes(s.id)))throw new TypeError('全篇衔接修订只能且必须返回当前两段，保留稳定ID')
    for(const item of output.segments){const old=next.story_segments.segments.find(s=>s.id===item.id);next.story_segments.segments=upsert(next.story_segments.segments,[{...old,title:item.title,revision:old.revision+1,body_ref:files[item.id]?.body_ref||old.body_ref,continuity_ref:files[item.id]?.continuity_ref||old.continuity_ref}])}
  }else{
    if(!output.segments.length||new Set(output.segments.map(row=>row.id)).size!==output.segments.length)throw new TypeError('故事段必须非空且ID不能重复')
    const existing=next.story_segments.segments,owned=existing.filter(segment=>inStoryUnit(segment,unit)),others=existing.filter(segment=>!inStoryUnit(segment,unit))
    if(output.segments.some(segment=>others.some(other=>other.id===segment.id)))throw new TypeError('不能覆盖其他原著阅读单元的故事段ID')
    const rows=output.segments.map(item=>{
      const old=owned.find(segment=>segment.id===item.id)
      return {id:item.id,sequence:1,revision:(old?.revision||0)+1,adaptation_revision:unit.adaptation_revision,source_chapter_ids:unit.source_chapter_ids,title:item.title,body_ref:files[item.id]?.body_ref||old?.body_ref||'artifacts/dry-run.txt',source_spans:unit.source_spans,continuity_ref:files[item.id]?.continuity_ref||old?.continuity_ref||null}
    })
    const order=segment=>Math.min(...segment.source_chapter_ids.map(id=>next.source_analysis.chapters.find(c=>c.id===id)?.sequence??Infinity))
    next.story_segments.segments=[...others,...rows].sort((a,b)=>order(a)-order(b))
    next.story_segments.segments.forEach((segment,index)=>{segment.sequence=index+1})
  }
}
export async function prepareText(projects,project,input,{signal}={}){
 const id=project.basic_info.id,units=[];
    if(project.node_states.adaptation_plan.status!=='confirmed'||!project.adaptation_plan.plot_text.trim())throw new TypeError('请先确认全篇联合改编指导')
    if(project.adaptation_plan.source_revision_id!==project.source.current_revision_id)throw new TypeError('请先按当前原稿更新全篇联合改编指导')
    if(project.source.current_revision_id&&(project.node_states.source_analysis.status!=='confirmed'||project.source_analysis.source_revision_id!==project.source.current_revision_id))throw new TypeError('请先完成当前原稿的原著解析')
    const guidance_ref=await projects.documents.writeArtifact(id,JSON.stringify(project.adaptation_plan),{extension:'json'})
    const chapters=project.source_analysis.chapters.length?project.source_analysis.chapters:[null]
    for(const chapter of chapters.filter(chapter=>!input.unit_id||(chapter?.id||'free')===input.unit_id)){
      const source_chapter_ids=chapter?[chapter.id]:[],source_spans=chapter?chapterRanges(project.source_analysis.chapters,project.source.current_revision_id).filter(range=>range.chapter_id===chapter.id).map(({chapter_id,...range})=>range):[]
      units.push({id:uid('unit'),kind:'story',source_chapter_ids,source_sequence:chapter?.sequence||1,adaptation_revision:project.adaptation_plan.revision,source_spans,read_refs:[guidance_ref],material:{chapter:chapter?{id:chapter.id,title:chapter.title}:null,guidance_ref,existing_segments:project.story_segments.segments.filter(segment=>inStoryUnit(segment,{source_chapter_ids})),instruction:'读取原著与全篇改编指导，自行确定本阅读范围内的叙事分段，返回按故事顺序排列的segments数组，每段写完整动作、对白和continuity。阅读单元只是原著读取范围，不是上游剧情计划。允许一段或多段，不预分集；修改时复用已有段ID，不改其他阅读单元。'}})
    }

 if(input.unit_id&&units.length===0)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
  const segments=project.story_segments.segments.filter(segment=>inStoryUnit(segment,unit)).sort((a,b)=>a.sequence-b.sequence)
  if(!segments.length)throw new TypeError('当前阅读单元尚无可修改正文，请先生成')
  return {segments:await Promise.all(segments.map(async segment=>({id:segment.id,title:segment.title,body:(await projects.documents.readArtifact(projectId,segment.body_ref)).toString(),continuity:segment.continuity_ref?(await projects.documents.readArtifact(projectId,segment.continuity_ref)).toString():''})))}

}
export async function writeCandidateFiles(projects,projectId,output){const files={};for(const segment of output.segments)files[segment.id]={body_ref:await projects.documents.writeArtifact(projectId,segment.body),continuity_ref:await projects.documents.writeArtifact(projectId,segment.continuity)};return files}
