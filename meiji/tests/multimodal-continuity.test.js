import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFixture, taskFixture } from './fixtures/project.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';
import { emptySceneModel } from '../shared/models/scene_model.js';
import { videoImages, videoType } from '../shared/video-inputs.js';
import { shotReferenceBindings } from '../shared/shot-text-inputs.js';
import { dependencyHash, expireDownstream, stampDependencyHash } from '../shared/node-dependencies.js';
import { createVideoPromptHandler } from '../server/handlers/video-prompt-handler.js';
import { createMediaHandler } from '../server/handlers/media-handler.js';
import { createAiRoutes } from '../server/http/ai-routes.js';
import { config } from './fixtures/ai.js';
import { precheck } from '../server/flow/tasks/precheck.js';
import { videoRequest } from '../server/http/video-request.js';
import { videoPayload } from '../server/http/llm-server/params.js';

function fixture(count=1) {
  const snapshot=snapshotFixture(),p=snapshot.project,e=p.episodes[0],[first,second]=e.shot_list.shots;
  p.character_library.characters=Array.from({length:count},(_,i)=>{
    const person=emptyCharacterModel({name:`人物${i+1}`});
    Object.assign(person.costume_images[0],{address:`person${i+1}.png`});
    person.costume_images[0].node_state.status='generated';
    return person;
  });
  second.on_screen_characters=p.character_library.characters.map(person=>({character_id:person.id,costume_id:''}));
  Object.assign(second.text_to_video_prompt,{integrated_multimodal_description:'[Shot 1] 人物1保持站姿。(S1)<d>出发吧。</d>',overall_soundscape:'风声',non_diegetic_music:'N/A'});
  return {snapshot,p,e,first,second};
}
const images=row=>videoImages(row.p,row.second).map(row=>row.image.address);

test('程序编排把尾帧排在人物和场景后，保存引用并原样用于多模态上传',async()=>{
  const row=fixture(),{p,e,first,second}=row;
  const scene=emptySceneModel({name:'大厅',description:'木门',layout:'入口朝南'});
  scene.reference_image.address='room.png';scene.reference_image.node_state.status='generated';
  p.scene_library.scenes=[scene];e.scene_catalog.scene_ids=[scene.id];
  first.scene_id=second.scene_id=scene.id;first.scene_state=second.scene_state='白天';
  assert.deepEqual(images(row),['person1.png','room.png','1.png']);
  const read=[],handler=createVideoPromptHandler({media:{validate:async()=>{},read:async address=>{read.push(address);return Buffer.from(address);}}});
  const {content}=await handler({snapshot:row.snapshot,task:{business_type:'multimodal',target_id:second.id},signal:new AbortController().signal});
  assert.deepEqual(read,images(row));assert.deepEqual(content.reference_images,images(row).map(address=>({address})));
  assert.match(content.prompt,/本镜首帧衔接参考 <Picture 3>/);
  assert.match(content.prompt,/上一镜 S01 的尾帧/);
  assert.match(content.prompt,/人物身份和服装以对应人物图为准/);
  const request=videoRequest({type:'多模态',textPrompt:Object.fromEntries(['integrated_multimodal_description','overall_soundscape','non_diegetic_music'].map(key=>[key,second.text_to_video_prompt[key]])),duration:5,aspectRatio:p.basic_info.aspect_ratio,referenceImages:read.map(address=>'data:image/png;base64,'+Buffer.from(address).toString('base64')),referenceBindings:shotReferenceBindings(p,e,second),packedPrompt:content.prompt});
  const payload=videoPayload({model:'MiniMax-H3',...request});
  assert.deepEqual(payload.images.map(data=>Buffer.from(data.split(',')[1],'base64').toString()),images(row));
  assert.equal('first_frame' in payload,false);assert.equal(payload.prompt,content.prompt);
  assert.equal(payload.prompt.split('出发吧。').length-1,1);
  Object.assign(second.multimodal_prompt,content);second.video_generation_type='多模态';
  const calls=[],ai=createAiRoutes({readConfig:async()=>({...config,video:{model:'MiniMax-H3'}}),gateway:{video:async options=>{calls.push(options);return{taskId:'continuity-video',url:'https://example.test/video.mp4'};}}});
  const generate=createMediaHandler({media:{validate:async()=>{},read:async address=>Buffer.from(address)},ai});
  const result=await generate({snapshot:row.snapshot,task:taskFixture(p,'video',second.id,{action:'generate'}),step:{kind:'generate'},signal:new AbortController().signal,record:async()=>{}});
  assert.equal(result.content.server_address,'https://example.test/video.mp4');assert.equal(calls.length,1);
  assert.deepEqual(calls[0].referenceImages.map(data=>Buffer.from(data.split(',')[1],'base64').toString()),images(row));
  assert.equal(calls[0].inputReference,undefined);assert.match(calls[0].prompt,/首帧衔接参考 <Picture 3>/);
  assert.equal(calls[0].prompt.split('出发吧。').length-1,1);
});

for(const [label,change] of [
  ['换场',r=>r.second.scene_transition='换场'],['切换机位',r=>r.second.scene_transition='切换机位'],
  ['场景不同',r=>r.first.scene_id='other'],['状态不同',r=>r.first.scene_state='夜晚'],
  ['前镜视频失效',r=>r.first.video.node_state.status='expired'],['尾帧失效',r=>r.first.last_frame.node_state.status='expired'],
  ['尾帧无地址',r=>r.first.last_frame.address=''],['首镜',r=>r.second.sequence=0],
]) test(`${label}不加入前尾帧，保留正常资产参考`,()=>{
  const row=fixture();change(row);assert.deepEqual(images(row),['person1.png']);assert.equal(videoType(row.p,row.e,row.second),'多模态');
});

test('没有资产图时仍用原首尾帧路径，没有有效尾帧则文生',()=>{
  const row=fixture(0);assert.deepEqual(images(row),[]);assert.equal(videoType(row.p,row.e,row.second),'首尾帧');
  row.first.last_frame.node_state.status='expired';assert.equal(videoType(row.p,row.e,row.second),'文生');
});

test('尾帧变化使连续后镜编排和视频过期，失效状态仍传播；换场不传播',()=>{
  for(const status of ['generated','expired']) {
    const {snapshot,p,e,first,second}=fixture();
    second.multimodal_prompt.node_state.status='generated';
    const before=dependencyHash(snapshot,'multimodal',second.id);
    first.last_frame.address='changed.png';
    assert.notEqual(dependencyHash(snapshot,'multimodal',second.id),before);
    first.last_frame.node_state.status=status;expireDownstream(snapshot,'tail',first.id);
    assert.equal(second.multimodal_prompt.node_state.status,'expired');assert.equal(second.video.node_state.status,'expired');
    assert.equal(second.video.address,'2.mp4');
  }
  const {snapshot,first,second}=fixture();second.scene_transition='换场';second.multimodal_prompt.node_state.status='generated';
  expireDownstream(snapshot,'tail',first.id);assert.equal(second.video.node_state.status,'generated');assert.equal(second.multimodal_prompt.node_state.status,'generated');
});

test('含尾帧共9张可编排，10张明确失败且不静默丢图',async()=>{
  const handler=createVideoPromptHandler({media:{validate:async()=>{},read:async address=>Buffer.from(address)}});
  for(const count of [8,9]) {
    const row=fixture(count),input={snapshot:row.snapshot,task:{business_type:'multimodal',target_id:row.second.id},signal:new AbortController().signal};
    assert.equal(images(row).length,count+1);
    if(count===8){const {content}=await handler(input);assert.equal(content.reference_images.length,9);assert.match(content.prompt,/首帧衔接参考 <Picture 9>/);}
    else await assert.rejects(handler(input),/9/);
  }
});

function stampAll(row) {
  const {snapshot,p,e}=row;
  for(const business of ['project-characters','project-summary'])stampDependencyHash(snapshot,business,p.basic_info.id);
  for(const business of ['episode-summary','outline','episode-scenes','shots'])stampDependencyHash(snapshot,business,e.id);
  for(const shot of e.shot_list.shots)for(const business of ['seconds','storyboard','first-last-frame','multimodal','video','tail'])stampDependencyHash(snapshot,business,shot.id);
}
test('前置检查核验尾帧来源的新鲜度，并在提交前拦截10图',()=>{
  for(const count of [8,9]) {
    const row=fixture(count);stampAll(row);
    const task={business_type:'multimodal',target_id:row.second.id,action:'generate'};
    if(count===8)assert.equal(precheck(row.snapshot,task).passed,true);
    else assert.throws(()=>precheck(row.snapshot,task),/最多9张/);
  }
  const row=fixture();stampAll(row);row.first.video.address='changed.mp4';
  assert.throws(()=>precheck(row.snapshot,{business_type:'multimodal',target_id:row.second.id,action:'generate'}),/前镜尾帧依赖已过期/);
});
