import {uid} from '../../shared/production/execution_support.js'
import {upsert} from '../../../shared/text/source.js'
import {assetView,candidateView,compileCandidate as compileContent,stripIdentifiers} from './model_content.js'
export {candidateView}
export function compileCandidate(unit,project,output,options){return compileContent(unit,project,output,{...options,mergeRevision})}

/** 修订基于已冻结的完整候选合并，未提及镜头不会被删除。 */
export function mergeRevision(unit,candidate,patch){
    const base=structuredClone(candidate),changes=structuredClone(patch)
    const existing=new Map(base.shots.map(shot=>[shot.id,shot]))
    if(base.shots.some(shot=>shot.story_segment_id!==unit.segment_id))throw new TypeError('修订候选必须全部属于当前故事段')
    const operations=new Set()
    for(const [kind,rows] of [['update',changes.shot_updates],['add',changes.shot_additions],['remove',changes.shot_removals]]){
        const seen=new Set()
        for(const row of rows){
            const id=kind==='remove'?row.shot_id:row.id
            if(seen.has(id))throw new TypeError('修订操作ID重复：'+id)
            if(operations.has(id))throw new TypeError('同一镜头的修订操作冲突：'+id)
            seen.add(id);operations.add(id)
            if(kind==='add'&&existing.has(id))throw new TypeError('新增镜头ID已存在：'+id)
            if(kind!=='add'&&!existing.has(id))throw new TypeError('待修订镜头ID不存在：'+id)
            if(kind!=='remove'&&row.story_segment_id!==unit.segment_id)throw new TypeError('修订镜头必须属于当前故事段')
        }
    }
    const removed=new Set(changes.shot_removals.map(row=>row.shot_id)),updates=new Map(changes.shot_updates.map(row=>[row.id,row]))
    let shots=[...base.shots.sort((a,b)=>a.sequence-b.sequence).filter(shot=>!removed.has(shot.id)).map(shot=>updates.get(shot.id)||shot),...changes.shot_additions]
    if(!shots.length)throw new TypeError('修订后的本段镜头必须非空')
    if(changes.shot_order.length){
        const ids=new Map(shots.map(shot=>[shot.id,shot]))
        if(changes.shot_order.length!==shots.length||new Set(changes.shot_order).size!==shots.length||changes.shot_order.some(id=>!ids.has(id)))throw new TypeError('shot_order必须完整且不重复地列出修订后的全部镜头ID')
        shots=changes.shot_order.map(id=>ids.get(id))
    }
    for(const kind of Object.keys(base.assets))base.assets[kind]=upsert(base.assets[kind],changes.assets[kind])
    const requirements=base.requirements.map(row=>({...row,shot_ids:row.shot_ids.filter(id=>!removed.has(id))})).filter(row=>row.shot_ids.length)
    return {assets:base.assets,shots:shots.map((shot,index)=>({...shot,sequence:index+1})),requirements:upsert(requirements,changes.requirements)}
}

export function applyCandidate(next,unit,output,files={}){
    for(const kind of Object.keys(next.asset_library)){const merged=output.assets[kind].map(asset=>{const old=next.asset_library[kind].find(row=>row.id===asset.id);if(!old)return asset;return {...asset,image_ids:[...new Set([...old.image_ids,...asset.image_ids])],selected_image_id:asset.selected_image_id??old.selected_image_id, ...(kind==='characters'?{voice_profile:{...asset.voice_profile,reference_audio_ref:asset.voice_profile.reference_audio_ref??old.voice_profile.reference_audio_ref,revision:Math.max(old.voice_profile.revision,asset.voice_profile.revision)}}:{})}});next.asset_library[kind]=upsert(next.asset_library[kind],merged)}
    if(!output.shots.length||output.shots.some(s=>s.story_segment_id!==unit.segment_id))throw new TypeError('分镜必须非空且全部属于当前故事段')
    if(output.shots.some(s=>s.beats.some(b=>b.duration_seconds>15)))throw new TypeError('单节拍不能超过15秒，请按实际动作分成可独立表达的节拍')
    const existing=next.shot_design.shots,other=existing.filter(s=>s.story_segment_id!==unit.segment_id)
    if(output.shots.some(s=>other.some(row=>row.id===s.id)))throw new TypeError('镜头ID已属于其他故事段，请复用本段ID或创建新ID')
    if(new Set(output.shots.map(s=>s.id)).size!==output.shots.length||new Set(output.shots.map(s=>s.sequence)).size!==output.shots.length)throw new TypeError('本段镜头ID和sequence必须唯一')
    const normalized=output.shots.map(shot=>({...shot,revision:(existing.find(s=>s.id===shot.id)?.revision||0)+1,story_segment_revision:next.story_segments.segments.find(s=>s.id===unit.segment_id).revision}))
    const segmentOrder=new Map(next.story_segments.segments.map(s=>[s.id,s.sequence]))
    next.shot_design.shots=[...other,...normalized].sort((a,b)=>segmentOrder.get(a.story_segment_id)-segmentOrder.get(b.story_segment_id)||a.sequence-b.sequence).map((shot,index)=>({...shot,sequence:index+1}))
    const removed=new Set(existing.filter(s=>s.story_segment_id===unit.segment_id&&!normalized.some(row=>row.id===s.id)).map(s=>s.id))
    const requirements=next.asset_requirements.items.map(row=>({...row,shot_ids:row.shot_ids.filter(id=>!removed.has(id))})).filter(row=>row.shot_ids.length)
    next.asset_requirements.items=upsert(requirements,output.requirements)

}
export async function prepareText(projects,project,input,{signal}={}){
 const id=project.basic_info.id,units=[];
    if(project.node_states.story_segments.status!=='confirmed'||!project.story_segments.segments.length)throw new TypeError('请先确认连续故事定稿')
    for(const segment of project.story_segments.segments.filter(p=>!input.unit_id||p.id===input.unit_id))units.push({id:uid('unit'),kind:'shots',segment_id:segment.id,read_refs:[segment.body_ref],material:{segment,group_plans:project.adaptation_plan.group_plans,asset_index_ref:'snapshot:/asset_library',instruction:'先读本段正文与已有资产索引，复用稳定ID，输出当前段镜头及确需新增/更新的资产定义和素材需求。'}})

 if(input.unit_id&&units.length===0)throw new TypeError('指定单元不存在');return units
}
export async function currentCandidate(projects,projectId,unit,project){
  const shots=project.shot_design.shots.filter(s=>s.story_segment_id===unit.segment_id);if(!shots.length)throw new TypeError('本段尚无可修改分镜')
  const ids=new Set(shots.flatMap(s=>[s.scene_id,...s.characters.flatMap(c=>[c.character_id,c.look_id]),...s.props.map(p=>p.prop_id)]).filter(Boolean))
  for(const look of project.asset_library.character_looks.filter(l=>ids.has(l.id)))for(const id of [look.character_id,...look.clothing_ids,...look.prop_ids])ids.add(id)
  return {assets:Object.fromEntries(Object.entries(project.asset_library).map(([kind,rows])=>[kind,rows.filter(row=>ids.has(row.id))])),shots,requirements:project.asset_requirements.items.filter(r=>r.shot_ids.some(id=>shots.some(s=>s.id===id)))}

}
/** 每段开始时冻结完整输入，后段可复用前段刚建立的资产。 */
export async function prepareUnit(ctx,project,unit){
 const segment=project.story_segments.segments.find(row=>row.id===unit.segment_id)
 if(!segment)throw new TypeError('指定故事段不存在')
 const read=async ref=>(await this.projects.documents.readArtifact(project.basic_info.id,ref)).toString()
 const [body,continuity]=await Promise.all([read(segment.body_ref),segment.continuity_ref?read(segment.continuity_ref):''])
 ctx.signal.throwIfAborted()
 const current={assets:Object.fromEntries(Object.keys(project.asset_library).map(kind=>[kind,[]])),shots:project.shot_design.shots.filter(s=>s.story_segment_id===unit.segment_id),requirements:[]}
 const prepared={...unit,context_mode:'complete',read_refs:[],material:{segment:{title:segment.title,body,continuity},adaptation_plan:stripIdentifiers(project.adaptation_plan),asset_library:assetView(project.asset_library),current_shots:candidateView(project,current).shots,instruction:'本段完整正文、衔接、改编指导及已有资产内容已提供。只写分镜内容和人物、造型、场景、道具名称，不生成或复制任何ID、版本号、图片引用或素材需求记录。镜头、节拍、对白和资产标识由程序维护。名称按资料准确填写，同名须用明确完整名称区分；新增资产先在assets给出名称及定义。生成提交本段完整镜头数组，修订按当前候选shot_number提交局部修改。'}}
 const unitRef=await this.projects.documents.writeArtifact(project.basic_info.id,JSON.stringify(prepared),{extension:'json'})
 return {unit:prepared,unitRef}
}
export async function writeCandidateFiles(projects,projectId,output){const files={};;return files}
export function afterCommit(next){next.node_states.reference_binding.product_revision++}
