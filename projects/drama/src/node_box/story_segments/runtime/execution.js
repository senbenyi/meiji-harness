import {uid,readJSON,stageStep} from '../../../shared/production/execution_support.js'
export function initialAction(unit){return unit.kind==='story_audit'?'review':'generate'}
export async function prepareUnit(ctx,current,unit,unitRef){const id=ctx.task.metadata.project_id;if(unit.kind!=='story_audit'){
        const previous=current.story_segments.segments.filter(s=>s.source_chapter_ids.some(id=>(current.source_analysis.chapters.find(c=>c.id===id)?.sequence??Infinity)<unit.source_sequence)).sort((a,b)=>b.sequence-a.sequence)[0]
        if(previous){unit={...unit,material:{...unit.material,previous_segment:previous},read_refs:[...(unit.read_refs||[]),...(previous.continuity_ref?[previous.continuity_ref]:[])]};unitRef=await this.projects.documents.writeArtifact(id,JSON.stringify(unit),{extension:'json'})}
      }
return {unit,unitRef}
}
export async function prepareCandidate(ctx,unit,unitRef){const id=ctx.task.metadata.project_id;let auditCandidateRef=null;if(unit.kind==='story_audit'&&!ctx.step.metadata.audit_started){
      const current=await this.projects.documents.read(id),items=[];unit.segment_revisions={}
      for(const segmentId of unit.segment_ids){const segment=current.story_segments.segments.find(s=>s.id===segmentId);unit.segment_revisions[segment.id]=segment.revision;items.push({id:segment.id,title:segment.title,body:(await this.projects.documents.readArtifact(id,segment.body_ref)).toString(),continuity:segment.continuity_ref?(await this.projects.documents.readArtifact(id,segment.continuity_ref)).toString():''})}
      auditCandidateRef=await this.projects.documents.writeArtifact(id,JSON.stringify({segments:items}),{extension:'json'});unitRef=await this.projects.documents.writeArtifact(id,JSON.stringify(unit),{extension:'json'})
    }
return {unit,unitRef,candidateRef:auditCandidateRef}
}
export async function afterReview(ctx,unit,unitRef){const id=ctx.task.metadata.project_id;if(unit.kind==='story_audit'){const current=await this.projects.documents.read(id);unit.segment_revisions=Object.fromEntries(unit.segment_ids.map(s=>[s,current.story_segments.segments.find(row=>row.id===s).revision]));unitRef=await this.projects.documents.writeArtifact(id,JSON.stringify(unit),{extension:'json'})}
return {unit,unitRef}
}
export async function afterUnits(ctx,manifest,manifestRef,done){const id=ctx.task.metadata.project_id;
      const project=await this.projects.documents.read(id),segments=[...project.story_segments.segments].sort((a,b)=>a.sequence-b.sequence),audits=[]
      if(!manifest.audit_prepared){
        const guidance_ref=await this.projects.documents.writeArtifact(id,JSON.stringify(project.adaptation_plan),{extension:'json'})
        for(let i=1;i<segments.length;i++)audits.push({id:uid('audit'),kind:'story_audit',initial_action:'review',segment_ids:[segments[i-1].id,segments[i].id],source_spans:[...new Map([...segments[i-1].source_spans,...segments[i].source_spans].map(span=>[JSON.stringify(span),span])).values()],read_refs:[guidance_ref],material:{instruction:'独立检查连续故事相邻段之间的因果、人物知情、位置、持物、动机与未决信息；必要修订同时返回这两段全文，其他段不变。',guidance_ref,locked_requirements:project.adaptation_plan.locked_requirements}})
      }else{
        for(const item of manifest.units){const unit=await readJSON(this.projects,id,done[item.id]?.unit_ref||item.ref);if(unit.kind==='story_audit'&&Object.entries(unit.segment_revisions||{}).some(([segment,revision])=>project.story_segments.segments.find(s=>s.id===segment)?.revision!==revision))audits.push({...unit,id:uid('audit'),segment_revisions:{}})}
      }
      if(audits.length){if((manifest.audit_pass||0)>=3)throw new TypeError('全篇衔接复核已达3轮，请查看问题后定向编辑/续接');const items=[];for(const unit of audits)items.push({id:unit.id,ref:await this.projects.documents.writeArtifact(id,JSON.stringify(unit),{extension:'json'})});const nextManifest={...manifest,completed:done,audit_prepared:true,audit_pass:(manifest.audit_pass||0)+1,units:[...manifest.units,...items]},ref=await this.projects.documents.writeArtifact(id,JSON.stringify(nextManifest),{extension:'json'});return [stageStep('review',{manifest_ref:ref,unit_ref:items[0].ref,phase:uid('phase')})]}

return [stageStep('finish',{manifest_ref:manifestRef})]
}
export function stepMetadata(unit){return unit.kind==='story_audit'?{audit_started:true}:{}}
