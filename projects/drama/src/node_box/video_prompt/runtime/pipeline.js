import {uid} from '../../shared/production/execution_support.js'
import {upsert} from '../../../shared/text/source.js'
import {promptContext} from './context.js'
import {compilePrompt,parsePrompt,validateStoredReferences} from './h3_prompt.js'

export function applyCandidate(next,unit,output,files={}){
    compilePrompt(unit,output.prompt)
    for(const voice of unit.required_voice_refs){const profile=next.asset_library.characters.find(c=>c.id===voice.character_id)?.voice_profile;if(profile?.reference_audio_ref!==voice.audio_ref||profile.revision!==voice.voice_revision)throw new TypeError('音色样本已变化，请重新生成提示词')}
    const old=next.video_prompt.items.find(p=>p.clip_id===unit.clip_id)
    next.video_prompt.items=upsert(next.video_prompt.items,[{id:old?.id||unit.output_id,clip_id:unit.clip_id,mode:unit.mode,revision:(old?.revision||0)+1,prompt_ref:files.prompt_ref||old?.prompt_ref||'artifacts/dry-run.txt',reference_images:unit.material.pictures.map(({image_id,label})=>({image_id,role:label})),voice_references:unit.required_voice_refs}])
}
export async function prepareText(projects,project,input){
    for(const speaker of new Set(project.shot_design.shots.flatMap(s=>s.beats.flatMap(b=>b.dialogues.map(d=>d.speaker_id))))){const voice=project.asset_library.characters.find(c=>c.id===speaker).voice_profile;if(!voice.description.trim()&&!voice.reference_audio_ref)throw new TypeError('发声人物缺少稳定声线设定，请在素材阶段补齐')}
    if(project.node_states.clip_arrangement.status!=='confirmed'||!project.clip_arrangement.clips.length)throw new TypeError('请先确认分片编排')
    const units=project.clip_arrangement.clips.filter(clip=>!input.unit_id||clip.id===input.unit_id).map(clip=>({id:uid('unit'),output_id:uid('prompt'),...promptContext(project,clip)}))
    if(!units.length)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
    const prompt=project.video_prompt.items.find(p=>p.clip_id===unit.clip_id);if(!prompt)throw new TypeError('本分片尚无可修改提示词')
    validateStoredReferences(unit,prompt)
    return {prompt:parsePrompt(unit,(await projects.documents.readArtifact(projectId,prompt.prompt_ref)).toString())}
}
export async function writeCandidateFiles(projects,projectId,output,unit){return {prompt_ref:await projects.documents.writeArtifact(projectId,compilePrompt(unit,output.prompt))}}
