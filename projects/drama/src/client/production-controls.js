import {element,showPanelDialog} from './ui/panel-dom.js'
const names={characters:'人物',clothing:'服装',props:'道具',scenes:'场景',character_looks:'人物造型'}
export function productionControls({root,section,project,stage,command,request,run,openEditor,openFields,openFile,fileUrl,active}){
 const button=(text,fn)=>{const b=element('button',text);b.type='button';b.onclick=async()=>{try{await fn()}catch(error){const notice=root.querySelector('[role=status]');if(notice){notice.textContent=error.message;notice.hidden=false}}};return b}
 const controls=element('div','','production-media-controls')
 const inputFile=(label,accept,action)=>{const field=element('input');field.type='file';field.accept=accept;field.hidden=true;field.setAttribute('aria-label',label);field.onchange=async()=>{const file=field.files?.[0];if(!file)return;try{if(file.size>48*1024*1024)throw new Error('文件最多48MiB');const bytes=new Uint8Array(await file.arrayBuffer());let data='';for(let i=0;i<bytes.length;i+=32768)data+=String.fromCharCode(...bytes.subarray(i,i+32768));await action(btoa(data),file.name)}catch(error){section.querySelector('[role=status]').textContent=error.message;section.querySelector('[role=status]').hidden=false}};const wrap=element('span');wrap.append(button(label,()=>field.click()),field);return wrap}
 const imageUrl=id=>`/api/drama/images/${encodeURIComponent(id)}`
 const gallery=async(asset,onSelect)=>{
  const dialog=element('dialog','','production-gallery'),head=element('div','','section-head'),title=element('h3',`为${asset.name}选图`),grid=element('div','','production-gallery-grid'),footer=element('div','','node-ui-buttons'),error=element('p','','error');let offset=0,total=0
  const close=()=>{if(dialog.open)dialog.close();dialog.remove()},load=async()=>{try{const data=await request(`images?offset=${offset}&limit=20`);total=data.total;grid.replaceChildren();for(const image of data.items){const choose=button('',async()=>{try{if(onSelect)await onSelect(image.id);else await command({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:image.id});close()}catch(e){error.textContent=e.message}}),img=element('img');img.src=image.url;img.alt=image.id;img.loading='lazy';choose.setAttribute('aria-label',`选用${image.id}`);choose.append(img,element('small',image.id));grid.append(choose)}}catch(e){error.textContent=e.message}}
  head.append(title,button('关闭',close));footer.append(button('上一页',()=>{offset=Math.max(0,offset-20);return load()}),button('下一页',()=>{if(offset+20<total)offset+=20;return load()}));dialog.append(head,error,grid,footer);root.append(dialog);showPanelDialog(dialog);await load()
 }
 if(stage==='asset_preparation'){
  const addDefinition=kind=>{
   if(kind==='character_looks'){
    if(!project.asset_library.characters.length)throw new Error('请先添加人物定义')
    const modal=element('dialog','','production-editor production-media-modal'),form=element('div','','production-field-form'),name=element('input'),description=element('textarea'),character=element('select'),clothing=element('select'),props=element('select'),hair=element('input'),error=element('p','','error');clothing.multiple=props.multiple=true
    const field=(label,input)=>{const row=element('label',label);input.setAttribute('aria-label',label);row.append(input);form.append(row)}
    for(const [input,rows]of [[character,project.asset_library.characters],[clothing,project.asset_library.clothing],[props,project.asset_library.props]])for(const item of rows){const option=element('option',item.name);option.value=item.id;input.append(option)}
    field('造型名称',name);field('造型描述',description);field('人物',character);field('服装（可多选）',clothing);field('可选道具（可多选）',props);field('发型与妆容',hair)
    const close=()=>{if(modal.open)modal.close();modal.remove()};modal.append(element('h3','新增人物造型'),form,error,button('取消',close),button('保存',async()=>{try{const library=structuredClone(project.asset_library);library.character_looks.push({id:'look_'+crypto.randomUUID(),name:name.value.trim(),description:description.value,character_id:character.value,clothing_ids:[...clothing.selectedOptions].map(o=>o.value),prop_ids:[...props.selectedOptions].map(o=>o.value),hair_and_makeup:hair.value,image_ids:[],selected_image_id:null});await command({kind:'product',stage:'asset_preparation',value:library,expected_revision:project.node_states.asset_preparation.product_revision});close()}catch(cause){error.textContent=cause.message}}));root.append(modal);showPanelDialog(modal);return
   }
   openFields(`新增${names[kind]}`,{name:'',description:'',...(kind==='characters'?{voice_description:''}:{})},value=>{const library=structuredClone(project.asset_library),{voice_description,...definition}=value,item={id:kind+'_'+crypto.randomUUID(),...definition,image_ids:[],selected_image_id:null};if(kind==='characters')Object.assign(item,{character_plan_id:null,voice_profile:{description:voice_description,reference_audio_ref:null,revision:0}});if(kind==='clothing')item.group_key='';if(kind==='scenes')Object.assign(item,{scene_plan_id:null,layout:'',entrances:'',landmarks:''});library[kind].push(item);return {kind:'product',stage:'asset_preparation',value:library,expected_revision:project.node_states.asset_preparation.product_revision}})
  }
  const add=element('div','','node-ui-buttons');for(const kind of Object.keys(names))add.append(button(`新增${names[kind]}`,()=>addDefinition(kind)));controls.append(add)
  for(const [kind,assets]of Object.entries(project.asset_library)){
   if(!assets.length)continue;controls.append(element('h4',names[kind]))
   for(const asset of assets){const card=element('article','','production-card asset-work-card'),strip=element('div','','production-image-strip'),actions=element('div','','node-ui-buttons');card.dataset.assetId=asset.id;card.append(element('h4',asset.name),element('p',asset.description))
    for(const imageId of asset.image_ids){const item=element('div'),img=element('img');img.src=imageUrl(imageId);img.alt=`${asset.name}候选`;img.loading='lazy';const selected=asset.selected_image_id===imageId;item.append(img,button(selected?'已选用':'选用此图',()=>command({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:imageId})));strip.append(item)}
    actions.append(inputFile('导入并选用图片','image/png,image/jpeg,image/webp',base64=>command({kind:'image_import',stage:'asset_preparation',target_id:asset.id,base64})),button('从图片库选用',()=>gallery(asset)),button('AI生成此素材',()=>run('asset_preparation',{target_id:asset.id,regenerate:!!asset.image_ids.length})))
    if(kind==='character_looks'&&asset.selected_image_id)actions.append(button('同时用作人物基础参考',()=>command({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:asset.selected_image_id,use_for_character:true})))
    if(kind==='characters'){
      actions.append(button('编辑稳定声线',()=>openFields('编辑稳定声线',{description:asset.voice_profile.description},value=>{const library=structuredClone(project.asset_library),character=library.characters.find(c=>c.id===asset.id);character.voice_profile.description=value.description;character.voice_profile.revision++;return {kind:'product',stage:'asset_preparation',value:library,expected_revision:project.node_states.asset_preparation.product_revision}})))
      const clean=element('input');clean.type='checkbox';clean.setAttribute('aria-label',`${asset.name}声线样本为单人干净声音`);const label=element('label','确认样本为单人干净声线（无其他人声/音乐）');label.prepend(clean)
      actions.append(label,inputFile('导入音色样本','audio/*',base64=>{if(!clean.checked)throw new Error('请先确认样本为单人干净声音');return command({kind:'audio_import',stage:'asset_preparation',character_id:asset.id,base64,confirmed_clean:true})}))
      if(asset.voice_profile.reference_audio_ref){const audio=element('audio');audio.controls=true;audio.src=fileUrl(asset.voice_profile.reference_audio_ref);audio.preload='metadata';card.append(audio)}
    }
    actions.append(button('编辑素材定义',()=>openFields('编辑素材定义',{name:asset.name,description:asset.description,...(kind==='scenes'?{layout:asset.layout,entrances:asset.entrances,landmarks:asset.landmarks}:{}),...(kind==='character_looks'?{hair_and_makeup:asset.hair_and_makeup}:{})},value=>{const library=structuredClone(project.asset_library);Object.assign(library[kind].find(a=>a.id===asset.id),value);return {kind:'product',stage:'asset_preparation',value:library,expected_revision:project.node_states.asset_preparation.product_revision}})))
    card.append(strip,actions);controls.append(card)
   }
  }
 }
 if(stage==='clip_arrangement'){
  for(const clip of project.clip_arrangement.clips){const card=element('article','','production-card'),mode=element('select'),first=element('input'),last=element('input');card.append(element('h4',`分片 ${clip.sequence}`));mode.setAttribute('aria-label','视频模式');for(const [value,label]of [['reference','参考生视频'],['text','文生视频'],['first_frame','首尾帧']]){const option=element('option',label);option.value=value;mode.append(option)}mode.value=clip.mode;first.value=clip.first_image_id||'';last.value=clip.last_image_id||'';first.placeholder='首帧图片ID';last.placeholder='可选尾帧图片ID'
   card.append(mode,first,button('选首帧',()=>gallery({name:'首帧'},id=>{first.value=id})),last,button('选尾帧',()=>gallery({name:'尾帧'},id=>{last.value=id})),element('p','首尾帧模式与参考图片/音色样本互斥；更换模式后需重新生成本分片提示词。','meta'),button('保存分片模式',()=>{const clips=project.clip_arrangement.clips.map(c=>c.id===clip.id?{...c,mode:mode.value,first_image_id:mode.value==='first_frame'?first.value||null:null,last_image_id:mode.value==='first_frame'?last.value||null:null}:c);return command({kind:'product',stage:'clip_arrangement',value:{clips},expected_revision:project.node_states.clip_arrangement.product_revision})}));controls.append(card)
  }
 }
 if(stage==='video_render'){
  for(const clip of project.clip_arrangement.clips){const card=element('article','','production-card');card.append(element('h4',`分片 ${clip.sequence} · ${clip.duration_seconds}秒`))
   card.append(inputFile('导入视频候选','video/*',base64=>command({kind:'video_import',stage:'video_render',clip_id:clip.id,base64})),button('生成/重生成此分片',()=>run('video_render',{unit_id:clip.id,regenerate:true})))
   for(const take of project.videos.filter(v=>v.clip_id===clip.id)){const video=element('video');video.controls=true;video.preload='metadata';video.src=fileUrl(take.file_ref);card.append(video,element('p',`提示词版本 ${take.prompt_revision} · 实际 ${take.duration_seconds.toFixed(2)}秒 · ${take.status==='approved'?'已人工选用':take.status==='rejected'?'已拒绝':'待检查候选'}`),button(take.status==='approved'?'已选用此视频':'检查画面/对白/声线后选用',()=>command({kind:'video_select',stage:'video_render',take_id:take.id})),button('拒绝此候选',()=>command({kind:'video_reject',stage:'video_render',take_id:take.id}))) }
   for(const take of project.videos.filter(v=>v.clip_id===clip.id&&v.status==='approved')){
    const voice=element('select'),start=element('input'),end=element('input'),clean=element('input');voice.setAttribute('aria-label','提取声线所属人物');for(const character of project.asset_library.characters){const option=element('option',character.name);option.value=character.id;voice.append(option)}start.type=end.type='number';start.value='0';end.value=String(Math.min(3,take.duration_seconds));start.step=end.step='0.1';start.setAttribute('aria-label','声线截取起点');end.setAttribute('aria-label','声线截取终点');clean.type='checkbox';clean.setAttribute('aria-label','确认截取为单人干净声音');const label=element('label','确认这一段为单人干净声音');label.prepend(clean);card.append(voice,start,end,label,button('截取为人物音色样本',()=>command({kind:'voice_extract',stage:'asset_preparation',take_id:take.id,character_id:voice.value,start_seconds:Number(start.value),end_seconds:Number(end.value),confirmed_clean:clean.checked})))
   }
   controls.append(card)
  }
 }
 if(stage==='editing'){
  controls.append(button('按已选视频重建时间线',()=>run('editing',{use_existing:false})))
  if(project.editing.preview_ref){const video=element('video');video.controls=true;video.preload='metadata';video.src=fileUrl(project.editing.preview_ref);controls.append(element('h4','上次渲染预览'),video)}
  for(const timeline of project.editing.timelines){const card=element('article','','production-card');card.append(element('h4',timeline.name),button('按当前时间线重新渲染',()=>run('editing',{use_existing:true,timeline_id:timeline.id})),inputFile('添加后期音轨','audio/*',base64=>command({kind:'audio_import',stage:'editing',role:'track',timeline_id:timeline.id,base64})))
   for(const edit of timeline.clips){const take=project.videos.find(v=>v.id===edit.take_id);card.append(element('p',`片段 ${edit.id} · 实际素材 ${take?.duration_seconds.toFixed(2)}秒`,'meta'),button('编辑入出点、位置与淡入淡出',()=>openFields('编辑剪辑片段',{in_seconds:edit.in_seconds,out_seconds:edit.out_seconds,position_seconds:edit.position_seconds,fade_seconds:timeline.transitions.find(t=>t.clip_id===edit.id)?.duration_seconds||0},value=>{const editing=structuredClone(project.editing),target=editing.timelines.find(t=>t.id===timeline.id),clip=target.clips.find(c=>c.id===edit.id);clip.in_seconds=value.in_seconds;clip.out_seconds=value.out_seconds;clip.position_seconds=value.position_seconds;target.transitions=target.transitions.filter(t=>t.clip_id!==edit.id);if(value.fade_seconds>0)target.transitions.push({clip_id:edit.id,duration_seconds:value.fade_seconds});target.revision++;return {kind:'product',stage:'editing',value:editing,expected_revision:project.node_states.editing.product_revision}})))}
   card.append(button('按当前剪辑重新生成字幕',()=>command({kind:'regenerate_subtitles',stage:'editing',timeline_id:timeline.id})))
   if(timeline.subtitles_ref)card.append(button('编辑字幕',()=>openFile(timeline.subtitles_ref,'editing')))
   if(timeline.audio_tracks_ref)card.append(button('编辑音轨编排',()=>openFile(timeline.audio_tracks_ref,'editing')))
   controls.append(card)
  }
 }
 if(stage==='delivery'){
  const duration=element('input');duration.type='number';duration.min='4';duration.placeholder='可选：目标单集秒数（后期分集）';duration.setAttribute('aria-label','目标单集秒数');controls.append(duration,button('按设置分集并导出',()=>run('delivery',duration.value?{episode_seconds:Number(duration.value)}:{})))
  controls.append(button('编辑输出规格',()=>openFields('输出规格（宽高、帧率、字幕、响度）',project.delivery.settings,value=>({kind:'product',stage:'delivery',value:{episodes:project.episodes,delivery:{...project.delivery,settings:value}},expected_revision:project.node_states.delivery.product_revision}))))
  for(const item of project.delivery.exports){const card=element('article','','production-card'),video=element('video'),download=element('a','下载成片');video.controls=true;video.preload='metadata';video.src=fileUrl(item.file_ref);download.href=fileUrl(item.file_ref,true);download.download='';card.append(element('h4',project.episodes.find(e=>e.id===item.episode_id)?.title||'连续成片'),video,download,button('查看验证报告',()=>openFile(item.validation_report_ref,'delivery',{readOnly:true})));if(item.subtitles_ref){const subtitle=element('a','下载本集字幕');subtitle.href=fileUrl(item.subtitles_ref,true);subtitle.download='';card.append(subtitle)}controls.append(card)}
 }
 if(controls.childNodes.length)section.append(controls)
 return {dispose(){for(const dialog of root.querySelectorAll('.production-gallery,.production-media-modal')){if(dialog.open)dialog.close();dialog.remove()}}}
}
