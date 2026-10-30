import {uid} from '../../production/execution_support.js'
import {upsert} from '../../production/source.js'

export function applyCandidate(next,unit,output,files={}){
    const old=next.video_prompt.items.find(p=>p.clip_id===unit.clip_id)
    next.video_prompt.items=upsert(next.video_prompt.items,[{id:old?.id||unit.output_id,clip_id:unit.clip_id,mode:unit.mode,revision:(old?.revision||0)+1,prompt_ref:files.prompt_ref||old?.prompt_ref||'artifacts/dry-run.txt',reference_images:output.reference_images,voice_references:output.voice_references}])
    const expected=new Set(unit.allowed_image_ids||[])
    if(output.reference_images.some(row=>!expected.has(row.image_id)))throw new TypeError('提示词引用图不是当前分片的已选参考图')
    if(unit.mode==='reference'&&(unit.allowed_image_ids||[]).some(id=>!output.reference_images.some(r=>r.image_id===id)))throw new TypeError('提示词遗漏分片已选的关键参考图')
    if((unit.required_voice_refs||[]).some(ref=>!output.voice_references.some(v=>JSON.stringify(v)===JSON.stringify(ref))))throw new TypeError('提示词遗漏已选的说话人音色样本')
    if(unit.mode==='reference'&&!output.reference_images.length)throw new TypeError('参考模式必须提供参考图')
    const dialogues=unit.material.dialogues||[]
    if(dialogues.some(row=>!output.prompt.includes(row.text)))throw new TypeError('提示词遗漏或改写了对白原文')
    for(const voice of output.voice_references){const character=next.asset_library.characters.find(c=>c.id===voice.character_id);if(character?.voice_profile.reference_audio_ref!==voice.audio_ref||character.voice_profile.revision!==voice.voice_revision)throw new TypeError('声音引用不是当前人物选定的音色样本')}
  
}
export async function prepareText(projects,project,input,{signal}={}){
 const id=project.basic_info.id,units=[];
    for(const speaker of new Set(project.shot_design.shots.flatMap(s=>s.beats.flatMap(b=>b.dialogues.map(d=>d.speaker_id))))){const voice=project.asset_library.characters.find(c=>c.id===speaker).voice_profile;if(!voice.description.trim()&&!voice.reference_audio_ref)throw new TypeError('发声人物缺少稳定声线设定，请在素材阶段补齐')}
    if(project.node_states.clip_arrangement.status!=='confirmed'||!project.clip_arrangement.clips.length)throw new TypeError('请先确认分片编排')
    for(const clip of project.clip_arrangement.clips.filter(p=>!input.unit_id||p.id===input.unit_id)){
      const shots=clip.sources.map(s=>project.shot_design.shots.find(shot=>shot.id===s.shot_id)),beats=clip.sources.flatMap((s,i)=>shots[i].beats.filter(b=>s.beat_ids.includes(b.id))),refs=[...new Set(shots.flatMap(s=>s.reference_images.map(r=>r.image_id)))]
      units.push({id:uid('unit'),kind:'prompt',clip_id:clip.id,mode:clip.mode,output_id:uid('prompt'),allowed_image_ids:refs,required_voice_refs:clip.mode==='reference'?[...new Set(beats.flatMap(b=>b.dialogues.map(d=>d.speaker_id)))].map(id=>project.asset_library.characters.find(c=>c.id===id)).filter(c=>c?.voice_profile.reference_audio_ref).map(c=>({character_id:c.id,voice_revision:c.voice_profile.revision,audio_ref:c.voice_profile.reference_audio_ref})):[],source_spans:[],material:{voice_profiles:project.asset_library.characters.filter(c=>beats.some(b=>b.dialogues.some(d=>d.speaker_id===c.id))).map(c=>({id:c.id,name:c.name,voice_profile:c.voice_profile})),clip,shots:shots.map((shot,i)=>({...shot,beats:shot.beats.filter(b=>clip.sources[i].beat_ids.includes(b.id))})),dialogues:beats.flatMap(b=>b.dialogues),shot_ids:shots.map(s=>s.id),reference_image_ids:refs,instruction:'读取对应镜头、节拍、人物声线和所选图映射；保留完整对白。'}})
    }
  
 if(input.unit_id&&units.length===0)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
  const prompt=project.video_prompt.items.find(p=>p.clip_id===unit.clip_id);if(!prompt)throw new TypeError('本分片尚无可修改提示词')
  return {prompt:(await projects.documents.readArtifact(projectId,prompt.prompt_ref)).toString(),reference_images:unit.mode==='reference'?prompt.reference_images:[],voice_references:unit.mode==='reference'?prompt.voice_references:[]}
 
}
export async function writeCandidateFiles(projects,projectId,output){const files={};files.prompt_ref=await projects.documents.writeArtifact(projectId,output.prompt);return files}
