import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {promptContext} from '../src/node_box/video_prompt/runtime/context.js'
import {compilePrompt,parsePrompt,validateStoredReferences} from '../src/node_box/video_prompt/runtime/h3_prompt.js'
import {fixture,mockPrompt} from './helpers/production-fixture.js'

function sample(mode='reference'){
 const character=(id,image)=>({id,name:id,description:'warrior',image_ids:[image],voice_profile:{description:'deep voice',reference_audio_ref:null,revision:1}})
 const project={asset_library:{characters:[character('char_a','img_a'),character('char_b','img_b')],scenes:[{id:'scene_a',name:'tent',description:'canvas tent',image_ids:['img_scene']}],character_looks:[{id:'look_a',character_id:'char_a',name:'armored warrior',description:'dark armor',image_ids:['img_look']}],clothing:[],props:[]},shot_design:{shots:[{id:'shot_1',reference_images:[{image_id:'img_b'},{image_id:'img_look'},{image_id:'img_a'},{image_id:'img_scene'}],beats:[{id:'beat_1',dialogues:[{speaker_id:'char_a',text:'来战！'},{speaker_id:'char_b',text:'好！'}]}]}]}}
 const clip={id:'clip_1',mode,duration_seconds:10,first_image_id:mode==='first_frame'?'img_a':null,last_image_id:null,sources:[{shot_id:'shot_1',beat_ids:['beat_1']}]}
 return {project,clip,unit:promptContext(project,clip)}
}
test('固定发送顺序，定妆与人物合并主体，说话人按本片发声次序编号',()=>{
 const {unit}=sample();assert.deepEqual(unit.allowed_image_ids,['img_b','img_look','img_a','img_scene'])
 assert.deepEqual(unit.material.subjects[1].pictures,['<Picture 2>','<Picture 3>'])
 assert.deepEqual(unit.material.speakers.map(s=>[s.label,s.subject]),[['(S1)','<Subject 2>'],['(S2)','<Subject 1>']])
 const fields=mockPrompt(unit),text=compilePrompt(unit,fields);assert.ok(compilePrompt(unit,{...fields,subject_definitions:fields.subject_definitions.replaceAll('> is','>: is')}));assert.deepEqual(parsePrompt(unit,text),fields);assert.ok(!text.includes('img_'))
 assert.throws(()=>validateStoredReferences(unit,{mode:'reference',reference_images:[...unit.allowed_image_ids].reverse().map(image_id=>({image_id})),voice_references:[]}),/参考顺序/)
})
test('结构、编号、原语对白、说话人和切镜错误在保存前拒绝',()=>{
 const {unit}=sample(),valid=mockPrompt(unit)
 const invalid=[
  {...valid,summary:undefined},
  {...valid,detailed_description:valid.detailed_description+' <Picture 9>'},
  {...valid,detailed_description:valid.detailed_description.replace('来战！','迎战！')},
  {...valid,detailed_description:valid.detailed_description.replace('(S1) says','(S2) says')},
  {...valid,detailed_description:valid.detailed_description+' [Shot 2] At 00:10.000, Cut away.'},
  {...valid,detailed_description:valid.detailed_description+' [Shot 3] At 00:03.000, Cut away.'},
  {...valid,detailed_description:valid.detailed_description+' Cut to a close-up.'},
  {...valid,detailed_description:valid.detailed_description+' 内部说明'},
  {...valid,detailed_description:valid.detailed_description+' img_abc'},
  {...valid,overall_soundscape:'a'.repeat(7001)}
 ]
 for(const fields of invalid)assert.throws(()=>compilePrompt(unit,fields),/H3提示词/)
 assert.throws(()=>parsePrompt(unit,'普通中文旧提示词'),/重新生成/)
 assert.throws(()=>parsePrompt(unit,'extra instruction\n'+compilePrompt(unit,valid)),/结构外前缀/)
 const cut={...valid,detailed_description:valid.detailed_description+' [Shot 2] At 00:03.000, The opponent steps back.'};assert.ok(compilePrompt(unit,cut))
})
test('文本、首帧及首尾帧按base三段编译，音频独立编号并绑定说话人',()=>{
 for(const mode of ['text','first_frame']){const {project,clip}=sample(mode);for(const last of [null,'img_b']){clip.last_image_id=last;const unit=promptContext(project,clip),fields=mockPrompt(unit),text=compilePrompt(unit,fields);assert.deepEqual(parsePrompt(unit,text),fields);if(mode==='first_frame')assert.ok(text.startsWith(last?'How the reference pictures align':'For the target video'))}}
 const {project,clip}=sample();project.asset_library.characters[0].voice_profile.reference_audio_ref='artifacts/voice.wav';const unit=promptContext(project,clip),fields=mockPrompt(unit)
 assert.equal(unit.material.audio[0].label,'<Audio 1>');assert.equal(unit.material.audio[0].subject,'<Subject 2>');assert.ok(compilePrompt(unit,fields).includes('[reference generation + audio reference]'))
 assert.throws(()=>compilePrompt(unit,{...fields,subject_definitions:fields.subject_definitions.replace('<Audio 1> provides','<Audio 2> provides')}),/未提供/)
})
test('真实发送保留官方六段和图片顺序，引用变化时在视频调用前失败',async t=>{
 const f=await fixture(t);for(const stage of ['source_analysis','adaptation_plan','story_segments','shot_design','asset_preparation','reference_binding','clip_arrangement','video_prompt'])await f.run(stage)
 let p=await f.project(),item=p.video_prompt.items[0],clip=p.clip_arrangement.clips[0]
 await f.run('video_render',{unit_id:clip.id});const sent=f.requests.filter(r=>r.path==='/videos/generations')[0].body
 assert.equal(sent.prompt,(await f.projects.documents.readArtifact(p.basic_info.id,item.prompt_ref)).toString());assert.ok(sent.prompt.startsWith('subject_definitions:\n'));assert.ok(sent.prompt.includes('<Subject 1>'));assert.ok(sent.prompt.includes('<d>[Chinese] 来战！</d>'))
 await f.projects.documents.mutate(p.basic_info.id,next=>{next.video_prompt.items[0].reference_images.reverse();return next})
 const count=f.requests.filter(r=>r.path==='/videos/generations').length,started=await f.production.run('video_render',{unit_id:clip.id,regenerate:true},{...f.context,requestId:randomUUID()}),result=await f.production.wait(started.group_id)
 assert.equal(result.status,'failed');assert.match(result.reason,/参考顺序/);assert.equal(f.requests.filter(r=>r.path==='/videos/generations').length,count)
})

test('未绑定图片的发声人保持无主体映射；漏写对白语言时给出明确修复格式',()=>{
 const {project,clip}=sample();project.shot_design.shots[0].reference_images=[{image_id:'img_b'},{image_id:'img_scene'}]
 const unit=promptContext(project,clip),fields=mockPrompt(unit)
 assert.equal(unit.material.speakers[0].subject,null);assert.equal(unit.material.dialogue_bindings[0].reference,'unreferenced speaker (S1)')
 assert.equal(unit.material.dialogue_bindings[0].dialogue,'<d>[Chinese] 来战！</d>');assert.ok(compilePrompt(unit,fields))
 assert.throws(()=>compilePrompt(unit,{...fields,detailed_description:fields.detailed_description.replace('(S1) says','<Subject 1> (S1) says')}),/没有参考主体/)
 assert.throws(()=>compilePrompt(unit,{...fields,detailed_description:fields.detailed_description.replace('<d>[Chinese]','<d>')}),/缺少语言标签/)
})

test('同一句对白允许跨切镜分成多个d标签，仍拒绝缺词、重复和换说话人',()=>{
 const {unit}=sample(),fields=mockPrompt(unit)
 const body=fields.detailed_description.replace('<d>[Chinese] 来战！</d>','<d>[Chinese] 来</d> Cut to [Shot 2] At 00:02.000, <Subject 2> (S1) says: <d>[Chinese] 战！</d>')
 const text=compilePrompt(unit,{...fields,detailed_description:body});assert.ok(text.includes('[Shot 2]'));assert.ok(parsePrompt(unit,text))
 for(const invalid of [body.replace('战！</d>','！</d>'),body.replace('战！</d>','来战！</d>'),body.replace('[Shot 2] At 00:02.000, <Subject 2> (S1)','[Shot 2] At 00:02.000, <Subject 1> (S2)')])assert.throws(()=>compilePrompt(unit,{...fields,detailed_description:invalid}),/H3提示词/)
})
