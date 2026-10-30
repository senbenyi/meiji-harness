import {uid} from '../../production/execution_support.js'
import {upsert} from '../../production/source.js'

export function applyCandidate(next,unit,output,files={}){
    for(const kind of Object.keys(next.asset_library)){const merged=output.assets[kind].map(asset=>{const old=next.asset_library[kind].find(row=>row.id===asset.id);if(!old)return asset;return {...asset,image_ids:[...new Set([...old.image_ids,...asset.image_ids])],selected_image_id:asset.selected_image_id??old.selected_image_id, ...(kind==='characters'?{voice_profile:{...asset.voice_profile,reference_audio_ref:asset.voice_profile.reference_audio_ref??old.voice_profile.reference_audio_ref,revision:Math.max(old.voice_profile.revision,asset.voice_profile.revision)}}:{})}});next.asset_library[kind]=upsert(next.asset_library[kind],merged)}
    if(!output.shots.length||output.shots.some(s=>s.story_segment_id!==unit.segment_id))throw new TypeError('分镜必须非空且全部属于当前故事段')
    if(output.shots.some(s=>s.beats.some(b=>b.duration_seconds>15)))throw new TypeError('单节拍不能超过15秒，请按实际动作分成可独立表达的节拍')
    const normalized=output.shots.map(shot=>({...shot,revision:(next.shot_design.shots.find(s=>s.id===shot.id)?.revision||0)+1,story_segment_revision:next.story_segments.segments.find(s=>s.id===unit.segment_id).revision}));next.shot_design.shots=upsert(next.shot_design.shots,normalized);const ordered=[...next.shot_design.shots].sort((a,b)=>a.sequence-b.sequence);ordered.forEach((shot,index)=>{shot.previous_shot_id=ordered[index-1]?.id||null});next.asset_requirements.items=upsert(next.asset_requirements.items,output.requirements)
  
}
export async function prepareText(projects,project,input,{signal}={}){
 const id=project.basic_info.id,units=[];
    if(project.node_states.story_segments.status!=='confirmed'||!project.story_segments.segments.length)throw new TypeError('请先确认连续故事定稿')
    for(const segment of project.story_segments.segments.filter(p=>!input.unit_id||p.id===input.unit_id))units.push({id:uid('unit'),kind:'shots',segment_id:segment.id,source_spans:segment.source_spans,read_refs:[segment.body_ref],material:{segment,group_plans:project.adaptation_plan.group_plans,asset_index_ref:'snapshot:/asset_library',instruction:'先读本段正文与已有资产索引，复用稳定ID，输出当前段镜头及确需新增/更新的资产定义和素材需求。'}})
  
 if(input.unit_id&&units.length===0)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
  const shots=project.shot_design.shots.filter(s=>s.story_segment_id===unit.segment_id);if(!shots.length)throw new TypeError('本段尚无可修改分镜')
  const ids=new Set(shots.flatMap(s=>[s.scene_id,...s.characters.flatMap(c=>[c.character_id,c.look_id]),...s.props.map(p=>p.prop_id)]).filter(Boolean))
  for(const look of project.asset_library.character_looks.filter(l=>ids.has(l.id)))for(const id of [look.character_id,...look.clothing_ids,...look.prop_ids])ids.add(id)
  return {assets:Object.fromEntries(Object.entries(project.asset_library).map(([kind,rows])=>[kind,rows.filter(row=>ids.has(row.id))])),shots,requirements:project.asset_requirements.items.filter(r=>r.shot_ids.some(id=>shots.some(s=>s.id===id)))}
 
}
export async function writeCandidateFiles(projects,projectId,output){const files={};;return files}
export function afterCommit(next){next.node_states.reference_binding.product_revision++}
