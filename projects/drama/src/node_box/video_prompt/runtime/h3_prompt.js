export const referenceSections=['subject_definitions','summary','retention_analysis','detailed_description','overall_soundscape','non_diegetic_music']
export const baseSections=['integrated_multimodal_description','overall_soundscape','non_diegetic_music']
const sections=unit=>unit.mode==='reference'?referenceSections:baseSections
const fail=message=>{throw new TypeError('H3提示词：'+message)}
const ids=(text,type)=>[...new Set([...text.matchAll(new RegExp(`<${type} (\\d+)>`,'g'))].map(match=>Number(match[1])))]
export function validatePrompt(unit,fields){
 const keys=sections(unit),material=unit.material
 if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length!==keys.length||keys.some(key=>typeof fields[key]!=='string'||!fields[key].trim()))fail('必须完整返回当前模式的结构字段')
 const text=keys.map(key=>fields[key]).join('\n'),body=fields[unit.mode==='reference'?'detailed_description':'integrated_multimodal_description']
 if(/\b(?:img|char|character|scene|shot|clip)_[A-Za-z0-9_-]+/.test(text))fail('最终文本不能包含内部资源ID，使用固定参考标签')
 const outsideDialogue=text.replace(/<d>[\s\S]*?<\/d>/g,'').replace(/“[^”]*”|"[^"]*"/g,'')
 if(/[\u3400-\u9fff]/.test(outsideDialogue))fail('描述正文使用英文；原语仅保留对白或引号内可见文字')
 const pictureCount=unit.mode==='reference'?material.pictures.length:unit.mode==='first_frame'?(material.clip.last_image_id?2:1):0
 if(ids(text,'Picture').some(n=>n<1||n>pictureCount)||ids(text,'Audio').some(n=>n<1||n>material.audio.length)||ids(text,'Subject').some(n=>n<1||n>material.subjects.length)||ids(text,'Video').length)fail('出现未提供的参考编号')
 if(unit.mode==='reference'){
  if(!fields.summary.startsWith(material.audio.length?'[reference generation + audio reference]':'[reference generation]'))fail('summary应以[reference generation]及实际音频关系开头')
  for(const picture of material.pictures)if(!fields.subject_definitions.includes(picture.label))fail('主体定义遗漏'+picture.label)
  for(const subject of material.subjects){
   const line=fields.subject_definitions.split('\n').find(row=>row.startsWith(subject.label))
   if(!line||subject.pictures.some(label=>!line.includes(label))||ids(line,'Picture').length!==subject.pictures.length)fail(subject.label+'定义与固定图片映射不符')
   if(!fields.retention_analysis.split('\n').some(row=>row.includes(subject.label)&&/\b(fully_preserved|partially_preserved|attribute_transfer|weak_reference)\b/.test(row)))fail(subject.label+'缺少参考保留说明')
  }
  for(const audio of material.audio){const line=fields.subject_definitions.split('\n').find(row=>row.startsWith(audio.label));if(!line||!line.includes(audio.speaker)||audio.subject&&!line.includes(audio.subject))fail(audio.label+'声线映射不符');if(!fields.retention_analysis.includes(audio.label))fail('遗漏音频参考关系')}
  if(/\(S\d+\)/.test(fields.retention_analysis))fail('retention_analysis不写说话人编号')
 }
 const spoken=[...body.matchAll(/<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>/g)],dialogues=material.dialogues
 if((text.match(/<d>/g)||[]).length!==spoken.length||(text.match(/<\/d>/g)||[]).length!==spoken.length)fail('每句对白须在镜头正文写为<d>[Chinese] 原文</d>，当前缺少语言标签或标签不完整；参照material.dialogue_bindings逐句填写')
 let lineIndex=0,offset=0,previousEnd=0
 for(const match of spoken){
  let chunk=match[2].trim()
  if(!chunk)fail('对白标签内容为空')
  const prefix=body.slice(previousEnd,match.index),labels=[...prefix.matchAll(/\(S\d+\)/g)]
  while(chunk.length){
   const line=dialogues[lineIndex];if(!line)fail('出现本片未提供的额外对白')
   const speaker=material.speakers.find(row=>row.character_id===line.speaker_id),remaining=line.text.slice(offset),length=Math.min(chunk.length,remaining.length)
   if(chunk.slice(0,length)!==remaining.slice(0,length))fail('对白原文或顺序不一致')
   if(labels.at(-1)?.[0]!==speaker.label)fail('对白说话人与固定编号不一致')
   if(unit.mode==='reference'&&speaker.subject&&!prefix.includes(speaker.subject+' '+speaker.label))fail('本句发声标注应为'+speaker.subject+' '+speaker.label+'，按material.dialogue_bindings填写')
   if(!speaker.subject&&[...prefix.matchAll(/<Subject \d+>\s*(\(S\d+\))/g)].some(match=>match[1]===speaker.label))fail(speaker.label+'没有参考主体，使用unreferenced speaker '+speaker.label+'，不绑定其他人物的Subject')
   offset+=length;chunk=chunk.slice(length)
   if(offset===line.text.length){lineIndex++;offset=0}
  }
  previousEnd=match.index+match[0].length
 }
 if(lineIndex!==dialogues.length||offset)fail('对白原文未完整保留')
 if([...text.matchAll(/\(S(\d+)\)/g)].some(match=>Number(match[1])<1||Number(match[1])>material.speakers.length))fail('存在额外说话人编号')
 const shots=[...body.matchAll(/\[Shot (\d+)\]/g)];if(!shots.length)fail('正文缺少[Shot 1]')
 let time=0
 for(const [index,shot]of shots.entries()){
  if(Number(shot[1])!==index+1)fail('镜头编号须从1连续递增')
  const segment=body.slice(shot.index+shot[0].length,shots[index+1]?.index??body.length).replace(/<d>[\s\S]*?<\/d>/g,''),content=shots[index+1]?segment.replace(/\bcut(?:s)?\s+to\s*$/i,''):segment,cuts=content.match(/\bcut(?:s)?\s+to\b/gi)||[]
  if(cuts.length>(index===0?0:1))fail('正文存在未标注的cut to切镜；每次切镜用新的[Shot N] At MM:SS.mmm，连续镜头则描述摄影机移动')
  const tail=body.slice(shot.index+shot[0].length),stamp=tail.match(/^\s+At (\d{2}):(\d{2})\.(\d{3}),/)
  if(index===0){if(stamp)fail('首镜不写切镜时间');continue}
  if(!stamp)fail('后续镜头需At MM:SS.mmm切镜时间')
  const seconds=Number(stamp[1])*60+Number(stamp[2])+Number(stamp[3])/1000
  if(seconds<=time||seconds>=material.clip.duration_seconds)fail('切镜时间必须递增且位于分片时长内');time=seconds
 }
 return fields
}
function keyframeInstruction(unit,fields){
 if(unit.mode!=='first_frame')return ''
 if(!unit.material.clip.last_image_id)return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
 const n=[...fields.integrated_multimodal_description.matchAll(/\[Shot (\d+)\]/g)].at(-1)[1]
 return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${n}) aligns with the ${unit.material.clip.duration_seconds.toFixed(2)}-second mark of the target video.`
}
export function compilePrompt(unit,fields){
 validatePrompt(unit,fields)
 const text=[keyframeInstruction(unit,fields),...sections(unit).map(key=>key+':\n'+fields[key].trim())].filter(Boolean).join('\n\n')
 if(text.length>7000)fail('最终文本超过7000字符')
 return text
}
export function parsePrompt(unit,text){
 const keys=sections(unit),headings=[...text.matchAll(new RegExp(`^(${keys.join('|')}):[ \\t]*\\n`,'gm'))]
 if(headings.length!==keys.length||headings.some((row,index)=>row[1]!==keys[index]))fail('已保存提示词不是当前官方结构，请重新生成')
 const fields=Object.fromEntries(headings.map((row,index)=>[row[1],text.slice(row.index+row[0].length,headings[index+1]?.index??text.length).trim()]))
 validatePrompt(unit,fields)
 const prefix=text.slice(0,headings[0].index).trim()
 if(prefix!==keyframeInstruction(unit,fields))fail('存在结构外前缀或首尾帧指令不一致')
 validatePrompt(unit,fields);if(compilePrompt(unit,fields)!==text)fail('最终文本格式或长度不一致')
 return fields
}

export function validateStoredReferences(unit,prompt){
 if(prompt.mode!==unit.mode||JSON.stringify(prompt.reference_images.map(row=>row.image_id))!==JSON.stringify(unit.allowed_image_ids)||JSON.stringify(prompt.voice_references)!==JSON.stringify(unit.required_voice_refs))fail('已保存参考顺序、素材或声线已变化，请重新生成提示词')
}
