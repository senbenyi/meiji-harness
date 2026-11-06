import {uid} from '../../shared/production/execution_support.js'
import {upsert} from '../../../shared/text/source.js'

const kinds=['characters','clothing','props','scenes','character_looks']
const emptyAssets=()=>Object.fromEntries(kinds.map(kind=>[kind,[]]))
const labels={characters:'人物',clothing:'服装',props:'道具',scenes:'场景',character_looks:'造型'}
function find(rows,name,kind,{optional=false}={}){
 const matches=rows.filter(row=>row.name===name||kind==='characters'&&row.name.split(/[／/]/).map(s=>s.trim()).includes(name))
 if(matches.length>1)throw new TypeError(`${labels[kind]}名称有歧义：${name}，请使用可区分的完整名称`)
 if(!matches.length&&!optional)throw new TypeError(`${labels[kind]}名称不存在：${name}。可用名称：${rows.map(row=>row.name).join('、')}；新增资产须在assets中先给出定义`)
 return matches[0]
}
const named=(rows,id)=>id===null?null:rows.find(row=>row.id===id)?.name
const mergedLibrary=(project,candidate)=>Object.fromEntries(kinds.map(kind=>[kind,upsert(structuredClone(project.asset_library[kind]),candidate?.assets[kind]||[])]))

/** 模型只看创作内容；图片、声线文件和所有内部标识留在程序中。 */
export function assetView(library,selection=library){
 return Object.fromEntries(kinds.map(kind=>[kind,selection[kind].map(row=>{
  const base={name:row.name,description:row.description}
  if(kind==='characters')return {...base,voice_description:row.voice_profile.description}
  if(kind==='clothing')return {...base,group:row.group_key}
  if(kind==='scenes')return {...base,layout:row.layout,entrances:row.entrances,landmarks:row.landmarks}
  if(kind==='character_looks')return {...base,character:named(library.characters,row.character_id),clothing:row.clothing_ids.map(id=>named(library.clothing,id)),props:row.prop_ids.map(id=>named(library.props,id)),hair_and_makeup:row.hair_and_makeup}
  return base
 })]))
}
export function candidateView(project,candidate){
 const library=mergedLibrary(project,candidate)
 return {assets:assetView(library,candidate.assets),shots:[...candidate.shots].sort((a,b)=>a.sequence-b.sequence).map((shot,index)=>({
  shot_number:index+1,scene:named(library.scenes,shot.scene_id),
  characters:shot.characters.map(row=>({name:named(library.characters,row.character_id),look:named(library.character_looks,row.look_id),opening_state:row.opening_state})),
  props:shot.props.map(row=>({name:named(library.props,row.prop_id),holder:named(library.characters,row.holder_character_id),opening_state:row.opening_state})),
  beats:shot.beats.map(beat=>({duration_seconds:beat.duration_seconds,action:beat.action,camera:beat.camera,scene_changes:beat.scene_changes,effects:beat.effects,
   dialogues:beat.dialogues.map(line=>({speaker:named(library.characters,line.speaker_id),text:line.text,delivery:structuredClone(line.delivery)})),soundscape:beat.soundscape,music:beat.music}))
 }))}
}
/** 生成资产定义并精确绑定名称；不从相似UUID或相似名称推测身份。 */
function compileAssets(project,definitions){
 const library=structuredClone(project.asset_library),changed=emptyAssets()
 for(const kind of kinds){
  const seen=new Set()
  for(const row of definitions[kind]){
   if(seen.has(row.name))throw new TypeError(`${labels[kind]}定义名称重复：${row.name}`)
   seen.add(row.name)
   const owner=kind==='character_looks'?find(library.characters,row.character,'characters'):null
   const scope=owner?library[kind].filter(item=>item.character_id===owner.id):library[kind]
   const old=find(scope,row.name,kind,{optional:true})
   const base={id:old?.id||uid('asset'),name:old?.name||row.name,description:row.description,image_ids:old?.image_ids||[],selected_image_id:old?.selected_image_id||null}
   let asset=base
   if(kind==='characters')asset={...base,character_plan_id:null,
    voice_profile:{description:row.voice_description,reference_audio_ref:old?.voice_profile.reference_audio_ref||null,revision:old?.voice_profile.revision||0}}
   if(kind==='clothing')asset={...base,group_key:row.group}
   if(kind==='scenes')asset={...base,scene_plan_id:null,layout:row.layout,entrances:row.entrances,landmarks:row.landmarks}
   if(kind==='character_looks')asset={...base,character_id:owner.id,clothing_ids:row.clothing.map(name=>find(library.clothing,name,'clothing').id),prop_ids:row.props.map(name=>find(library.props,name,'props').id),hair_and_makeup:row.hair_and_makeup}
   if(changed[kind].some(item=>item.id===asset.id))throw new TypeError(`${labels[kind]}重复定义同一资产：${row.name}`)
   library[kind]=upsert(library[kind],[asset]);changed[kind].push(asset)
  }
 }
 return {library,changed}
}
function compileShot(unit,project,library,content,old,sequence){
 const segment=project.story_segments.segments.find(row=>row.id===unit.segment_id)
 const characters=content.characters.map(row=>{
  const character=find(library.characters,row.name,'characters')
  let look=null
  if(row.look!==null){
   const scope=library.character_looks.filter(item=>item.character_id===character.id)
   look=find(scope,row.look,'character_looks',{optional:true})
   if(!look)throw new TypeError(`造型“${row.look}”不属于人物“${character.name}”或不存在。该人物可用造型：${scope.map(item=>item.name).join('、')}`)
  }
  return {character_id:character.id,look_id:look?.id||null,opening_state:row.opening_state}
 })
 return {id:old?.id||uid('shot'),sequence,revision:old?.revision||1,story_segment_id:unit.segment_id,story_segment_revision:segment.revision,
  scene_id:content.scene===null?null:find(library.scenes,content.scene,'scenes').id,characters,
  props:content.props.map(row=>({prop_id:find(library.props,row.name,'props').id,holder_character_id:row.holder===null?null:find(library.characters,row.holder,'characters').id,opening_state:row.opening_state})),reference_images:old?.reference_images||[],
  beats:content.beats.map((beat,index)=>({id:old?.beats[index]?.id||uid('beat'),...structuredClone(beat),dialogues:beat.dialogues.map((line,lineIndex)=>({id:old?.beats[index]?.dialogues[lineIndex]?.id||uid('line'),speaker_id:find(library.characters,line.speaker,'characters').id,text:line.text,delivery:structuredClone(line.delivery)}))}))}
}
function requirements(project,library,shots){
 const targets=new Map(),add=(kind,id,shotId)=>{if(!id)return;const key=kind+':'+id;if(!targets.has(key))targets.set(key,{kind,id,shots:[]});targets.get(key).shots.push(shotId)}
 for(const shot of shots){
  add('scene',shot.scene_id,shot.id)
  for(const row of shot.characters)add(row.look_id?'character_look':'character',row.look_id||row.character_id,shot.id)
  for(const row of shot.props){const combined=shot.characters.some(c=>library.character_looks.find(l=>l.id===c.look_id)?.prop_ids.includes(row.prop_id));if(!combined)add('prop',row.prop_id,shot.id)}
 }
 const kindMap={character:'characters',character_look:'character_looks',scene:'scenes',prop:'props'}
 const current=new Set(project.shot_design.shots.filter(row=>shots.some(s=>s.story_segment_id===row.story_segment_id)).map(row=>row.id))
 return [...targets.values()].map(target=>{
  const old=project.asset_requirements.items.find(row=>row.kind===target.kind&&row.target_id===target.id),asset=library[kindMap[target.kind]].find(row=>row.id===target.id),image=asset.selected_image_id||(asset.image_ids.length===1?asset.image_ids[0]:null)
  return {id:old?.id||uid('requirement'),kind:target.kind,target_id:target.id,shot_ids:[...new Set([...(old?.shot_ids||[]).filter(id=>!current.has(id)),...target.shots])],strategy:image?'reuse':'generate',status:image?'ready':'pending',image_id:image}
 })
}
export function compileCandidate(unit,project,output,{action,candidate,mergeRevision}){
 const {library,changed}=compileAssets(project,output.assets)
 let result
 if(action==='revise'){
  const ordered=[...candidate.shots].sort((a,b)=>a.sequence-b.sequence)
  const at=number=>{if(!Number.isSafeInteger(number)||number<1||number>ordered.length)throw new TypeError('待修订镜头序号不存在：'+number);return ordered[number-1]}
  const additions=output.shot_additions.map((shot,index)=>compileShot(unit,project,library,shot,null,ordered.length+index+1))
  const slots=[...ordered,...additions]
  const patch={assets:changed,shot_updates:output.shot_updates.map(row=>compileShot(unit,project,library,row.shot,at(row.shot_number),row.shot_number)),shot_additions:additions,
   shot_removals:output.shot_removals.map(row=>({shot_id:at(row.shot_number).id,reason:row.reason})),shot_order:output.shot_order.map(number=>{if(!Number.isSafeInteger(number)||number<1||number>slots.length)throw new TypeError('重排镜头序号不存在：'+number);return slots[number-1].id}),requirements:[]}
  result=mergeRevision(unit,candidate,patch)
 }else{
  const existing=project.shot_design.shots.filter(row=>row.story_segment_id===unit.segment_id).sort((a,b)=>a.sequence-b.sequence)
  result={assets:changed,shots:output.shots.map((shot,index)=>compileShot(unit,project,library,shot,existing[index],index+1)),requirements:[]}
 }
 result.requirements=requirements(project,library,result.shots)
 return result
}

export function stripIdentifiers(value){
 if(Array.isArray(value))return value.map(stripIdentifiers)
 if(!value||typeof value!=='object')return value
 return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='id'&&!/_(id|ids|ref)$/.test(key)).map(([key,item])=>[key,stripIdentifiers(item)]))
}
