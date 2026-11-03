// 编号只按本次实际发送顺序分配；同一主体可来自多张参考图片。
export function promptContext(project,clip){
 const shots=clip.sources.map(source=>{const shot=project.shot_design.shots.find(row=>row.id===source.shot_id);return {...shot,beats:shot.beats.filter(beat=>source.beat_ids.includes(beat.id))}})
 const dialogues=shots.flatMap(shot=>shot.beats.flatMap(beat=>beat.dialogues))
 const ids=clip.mode==='reference'?[...new Set(shots.flatMap(shot=>shot.reference_images.map(row=>row.image_id)))]:[]
 const voices=clip.mode==='reference'?[...new Set(dialogues.map(row=>row.speaker_id))].map(id=>project.asset_library.characters.find(row=>row.id===id)).filter(row=>row.voice_profile.reference_audio_ref).map(row=>({character_id:row.id,voice_revision:row.voice_profile.revision,audio_ref:row.voice_profile.reference_audio_ref})):[]
 const subjects=[],pictures=ids.map((image_id,index)=>{
  const label=`<Picture ${index+1}>`,sources=Object.entries(project.asset_library).flatMap(([kind,rows])=>rows.filter(row=>row.image_ids.includes(image_id)).map(row=>({...row,kind})))
  for(const asset of sources){
   const key=asset.kind==='character_looks'?asset.character_id:asset.id
   let subject=subjects.find(row=>row.asset_id===key)
   if(!subject){subject={label:`<Subject ${subjects.length+1}>`,asset_id:key,name:asset.kind==='character_looks'?project.asset_library.characters.find(row=>row.id===key).name:asset.name,pictures:[],sources:[]};subjects.push(subject)}
   if(!subject.pictures.includes(label))subject.pictures.push(label)
   subject.sources.push({picture:label,name:asset.name,kind:asset.kind,description:asset.description})
  }
  if(!sources.length)subjects.push({label:`<Subject ${subjects.length+1}>`,asset_id:image_id,name:`Reference content ${index+1}`,pictures:[label],sources:[{picture:label,description:shots.flatMap(shot=>shot.reference_images).find(row=>row.image_id===image_id)?.role||'Visual reference'}]})
  return {label,image_id}
 })
 const speakers=[...new Set(dialogues.map(row=>row.speaker_id))].map((id,index)=>{const character=project.asset_library.characters.find(row=>row.id===id);return {label:`(S${index+1})`,character_id:id,name:character.name,description:character.description,voice_profile:character.voice_profile,subject:subjects.find(row=>row.asset_id===id)?.label||null}})
 const dialogue_bindings=dialogues.map(line=>{const speaker=speakers.find(row=>row.character_id===line.speaker_id),language=/[\u3400-\u9fff]/.test(line.text)?'Chinese':'Original language';return {speaker:speaker.label,subject:speaker.subject,reference:speaker.subject?`${speaker.subject} ${speaker.label}`:`unreferenced speaker ${speaker.label}`,dialogue:`<d>[${language}] ${line.text}</d>`}})
 const audio=voices.map((voice,index)=>({label:`<Audio ${index+1}>`,...voice,speaker:speakers.find(row=>row.character_id===voice.character_id).label,subject:subjects.find(row=>row.asset_id===voice.character_id)?.label||null}))
 return {kind:'prompt',clip_id:clip.id,mode:clip.mode,allowed_image_ids:ids,required_voice_refs:voices,source_spans:[],material:{clip,shots,dialogues,dialogue_bindings,pictures,subjects,speakers,audio,instruction:'本单元已提供当前分片完整镜头、对白、声线和固定参考映射；短资料随首轮提供时可直接使用。只处理本片，按官方结构写英文描述，原语对白放入<d>，严格使用给定编号。图片与音频顺序由程序保存。'}}
}
