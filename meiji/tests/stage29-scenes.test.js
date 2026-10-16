import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { projectFixture, snapshotFixture, taskFixture } from './fixtures/project.js';
import { emptySceneModel } from '../shared/models/scene_model.js';
import { emptyEpisode } from '../shared/project_contract.js';
import { mergeScenes, sceneText, shotScene } from '../shared/scene-inputs.js';
import { videoType, videoImages } from '../shared/video-inputs.js';
import { dependencyHash, stampDependencyHash, isNodeCurrent, expireDownstream } from '../shared/node-dependencies.js';
import { precheck } from '../server/flow/tasks/precheck.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { createVideoPromptHandler } from '../server/handlers/video-prompt-handler.js';
import { videoRequest } from '../server/http/video-request.js';
import { videoPayload } from '../server/http/llm-server/params.js';
import { composeNodePrompt, validateNodeResult } from '../server/http/ai-routes.js';
import { renderTaskPanel } from '../client/task-panel.js';
import { migrateScenes } from '../server/data/scene-migration.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';

const png = 'data:image/png;base64,aGVsbG8=';
function withScene(p = projectFixture()) {
  const scene = emptySceneModel({name:'老宅客厅',description:'反复出现的家中客厅',layout:'木门与窗户相对，木桌位于中央',materials:'灰墙、深色木桌',lighting:'窗边自然光'});
  p.scene_library.scenes.push(scene);
  const e=p.episodes[0]; e.scene_catalog.scene_ids=[scene.id];
  for (const shot of e.shot_list.shots) Object.assign(shot,{scene_id:scene.id,scene_state:'白天',scene_transition:'切换机位'});
  for (const shot of e.shot_list.shots) { shot.text_to_video_prompt.overall_soundscape='室内底噪'; shot.text_to_video_prompt.non_diegetic_music='N/A'; }
  scene.reference_image.address='room.png'; scene.reference_image.node_state.status='generated';
  const snapshot={project:p,tasks:[],steps:[],groups:[]};
  stampDependencyHash(snapshot,'scene-image',scene.id);
  stampDependencyHash(snapshot,'shots',e.id);
  for (const shot of e.shot_list.shots) for (const b of ['seconds','storyboard','multimodal','video','tail']) stampDependencyHash(snapshot,b,shot.id);
  return {p,e,scene,snapshot};
}
test('场景按地点复用，同名与别名ID保留原图片；空提取不删除全局资料',()=>{
  const {p,scene}=withScene();
  const row={...sceneText(scene),id:'',description:'仍是原客厅'};
  const merged=mergeScenes(p,[row]);
  assert.equal(merged.scenes.length,1);assert.equal(merged.scene_ids[0],scene.id);
  assert.equal(merged.scenes[0].reference_image.address,'room.png');
  assert.equal(mergeScenes(p,[{...row,id:scene.id,name:'家里客厅'}]).scene_ids[0],scene.id);
  assert.equal(mergeScenes(p,[]).scenes.length,1);assert.deepEqual(mergeScenes(p,[]).scene_ids,[]);
  assert.throws(()=>mergeScenes(p,[row,row]),/重复/);
  assert.throws(()=>mergeScenes(p,[{...row,id:'sc_unknown'}]),/已有ID/);
});
test('场景提取三动作强调选择性收录与去重，允许空结果，拒绝未知ID',()=>{
  const p=projectFixture(),e=p.episodes[0],snapshot={project:p,tasks:[],steps:[]};
  for (const action of ['generate','regenerate','review']) {
    const input=taskNodeInput(snapshot,taskFixture(p,'episode-scenes',e.id),null,action);
    const prompt=composeNodePrompt('episode-scenes',action,input,'codex-gpt');
    assert.match(prompt.system,/一次性、不重要地点/);assert.match(prompt.system,/返回空数组/);
    assert.match(prompt.system,/同一段拆成多个镜头/);assert.match(prompt.system,/昼夜.*天气/);
    if(action==='generate') assert.deepEqual(validateNodeResult('episode-scenes',action,{scenes:[]},input),{scenes:[]});
  }
});
test('场景再审核读取本任务拆并历史并按顺序核查，不混入别的任务或未来意见',()=>{
  const p=projectFixture(),e=p.episodes[0],task=taskFixture(p,'episode-scenes',e.id);
  const steps=[
    {task_id:task.id,seq:3,kind:'review',step_status:'rejected',result:{原因:'同一场地应合并总体布局'}},
    {task_id:'other',seq:4,kind:'review',step_status:'rejected',result:{原因:'其他任务不得泄漏'}},
    {task_id:task.id,seq:5,kind:'review',step_status:'rejected',result:{原因:'检查合并后的场内外分区'}},
    {task_id:task.id,seq:9,kind:'review',step_status:'rejected',result:{原因:'未来意见不得泄漏'}},
  ];
  const input=taskNodeInput({project:p,steps},task,{scenes:[],scene_ids:[]},'review',{seq:7,kind:'review'});
  assert.ok(input.opinion.indexOf('同一场地应合并')<input.opinion.indexOf('检查合并后'));
  assert.doesNotMatch(input.opinion,/不得泄漏/);
  const prompt=composeNodePrompt('episode-scenes','review',input,'codex-gpt');
  assert.match(prompt.user,/同一场地应合并总体布局/);
  assert.match(prompt.system,/同一连续室外场地/);assert.match(prompt.system,/不得改口要求重新拆分/);
});
test('大纲后必须先完成场景选择；空选择通过后镜头表不强制建档和配图',()=>{
  const p=projectFixture(),e=p.episodes[0],snapshot={project:p,tasks:[],steps:[]};
  const task=taskFixture(p,'shots',e.id,{action:'regenerate'});
  e.scene_catalog.node_state.status='empty';
  assert.throws(()=>precheck(snapshot,task),/提取场景/);
  e.scene_catalog.node_state.status='generated';stampDependencyHash(snapshot,'episode-scenes',e.id);
  assert.equal(precheck(snapshot,task).passed,true);
});
test('隔离真实任务链：空场景提取通过、人工指定场景、再次提取复用ID，拒绝候选不改共享资料',async()=>{
  const home=await mkdtemp(join(tmpdir(),'meiji-scenes-'));let runtime;
  try {
    const p=projectFixture(),e=p.episodes[0];e.scene_catalog.has_result=false;e.scene_catalog.node_state.status='empty';
    let rows=[],reject=false;
    runtime=await createAppRuntime({home,gateway:{chat:async({step})=>step.kind==='review'?{是否通过:!reject,原因:reject?'重复地点需合并':''}:{scenes:rows}}});
    const model=await runtime.repository.create(p);
    const submit=async fields=>{const result=await runtime.tasks.command({project_id:p.id,request_id:crypto.randomUUID(),...fields});await runtime.tasks.idle(p.id);return model.read().tasks.find(t=>t.id===result.task_id);};
    assert.equal((await submit({type:'submit',business_type:'episode-scenes',target_id:e.id,action:'generate'})).task_status,'completed');
    let current=model.read();assert.equal(current.project.episodes[0].scene_catalog.has_result,true);assert.deepEqual(current.project.episodes[0].scene_catalog.scene_ids,[]);
    assert.equal(isNodeCurrent(current,'episode-scenes',e.id),true);
    rows=[{id:'',name:'指定客厅',description:'用户要求固定的地点',layout:'门在北墙',materials:'木地板',lighting:'窗边光'}];
    assert.equal((await submit({type:'manual-edit',business_type:'episode-scenes',target_id:e.id,content:{scenes:rows}})).task_status,'completed');
    const id=model.read().project.scene_library.scenes[0].id;
    assert.equal((await submit({type:'submit',business_type:'episode-scenes',target_id:e.id,action:'regenerate'})).task_status,'completed');
    assert.equal(model.read().project.scene_library.scenes[0].id,id);
    reject=true;rows=[{...rows[0],id,layout:'错误候选：门改在东墙'}];
    assert.equal((await submit({type:'submit',business_type:'episode-scenes',target_id:e.id,action:'regenerate'})).task_status,'rejected');
    assert.equal(model.read().project.scene_library.scenes[0].layout,'门在北墙');
  } finally {await runtime?.dispose();await rm(home,{recursive:true,force:true});}
});
test('镜头场景引用、状态和衔接校验，节拍及最终提示读取统一资料',()=>{
  const {p,e,scene,snapshot}=withScene(),shot=e.shot_list.shots[0];
  const task=taskFixture(p,'shots',e.id),input=taskNodeInput(snapshot,task,null,'regenerate');
  const row=input.content.shots[0];
  assert.throws(()=>validateNodeResult('shots','generate',{shots:[{...row,scene_id:'sc_unknown'}]},input),/scene_id/);
  assert.throws(()=>validateNodeResult('shots','generate',{shots:[{...row,scene_transition:'随便'}]},input),/scene_transition/);
  assert.equal(shotScene(p,shot).layout,scene.layout);
  const seconds=taskNodeInput(snapshot,taskFixture(p,'seconds',shot.id),null,'generate');
  assert.equal(seconds.shot.scene.id,scene.id);
  const final=taskNodeInput(snapshot,taskFixture(p,'storyboard',shot.id),null,'generate');
  assert.equal(final.storyboard.shot_setup.scene.layout,scene.layout);
});
test('连续接拍须同地点同状态；换场、反打、回到旧场景使用场景参考而非前镜尾帧',()=>{
  const {e}=withScene(),[a,b]=e.shot_list.shots;
  assert.equal(videoType(e,a),'多模态');assert.equal(videoType(e,b),'多模态');
  b.scene_transition='连续接拍';assert.equal(videoType(e,b),'首尾帧');
  b.scene_state='夜晚';assert.equal(videoType(e,b),'多模态');
  b.scene_state=a.scene_state;b.scene_id='other';assert.equal(videoType(e,b),'多模态');
  b.scene_id='';b.scene_transition='换场';assert.equal(videoType(e,b),'文生');
});
test('场景图变化只使使用它的素材编排和视频过期；场景文字变化触达相关镜头并保留内容',()=>{
  const {p,e,scene,snapshot}=withScene(),shot=e.shot_list.shots[0];
  const unrelated=emptyEpisode({plot:'另一地点'});p.episodes.push(unrelated);
  shot.multimodal_prompt.node_state.status='generated';stampDependencyHash(snapshot,'multimodal',shot.id);
  const textHash=dependencyHash(snapshot,'seconds',shot.id),oldVideo=shot.video.address;
  scene.reference_image.address='room-new.png';expireDownstream(snapshot,'scene-image',scene.id);
  assert.equal(shot.multimodal_prompt.node_state.status,'expired');assert.equal(shot.video.node_state.status,'expired');
  assert.equal(dependencyHash(snapshot,'seconds',shot.id),textHash);assert.equal(shot.seconds_storyboard.node_state.status,'generated');assert.equal(shot.video.address,oldVideo);
  scene.layout='窗户与门的固定位置变更';expireDownstream(snapshot,'scene-setting',scene.id);
  assert.equal(e.shot_list.node_state.status,'expired');assert.equal(shot.seconds_storyboard.node_state.status,'expired');
  assert.equal(unrelated.shot_list.node_state.status,'empty');
});
test('场景参考图缺失阻断多模态；程序编排把场景作为独立参考，人物背景不混入场景',async()=>{
  const {p,e,scene,snapshot}=withScene(),shot=e.shot_list.shots[0],task=taskFixture(p,'multimodal',shot.id,{action:'generate'});
  assert.equal(videoImages(p,shot).length,1);assert.equal(videoImages(p,shot)[0].business_type,'scene-image');
  scene.reference_image.node_state.status='empty';
  assert.throws(()=>precheck(snapshot,task),/场景参考图/);scene.reference_image.node_state.status='generated';
  const handler=createVideoPromptHandler({media:{validate:async()=>{},read:async()=>Buffer.from('image')}});
  const result=await handler({snapshot,task,signal:new AbortController().signal});
  assert.deepEqual(result.content.reference_images,[{address:'room.png'}]);
  assert.match(result.content.prompt,/<Subject 1>.*场景/);assert.match(result.content.prompt,/不复制图中人物/);
  assert.match(result.content.prompt,/白天/);assert.match(result.content.prompt,/不能把定妆照背景带入场景/);
  assert.throws(()=>videoPayload({model:'MiniMax-H3',mode:'reference',duration:5,prompt:'x',referenceImages:Array(10).fill(png)}),/1 到 9/);
  assert.throws(()=>videoPayload({model:'MiniMax-H3',mode:'reference',duration:5,prompt:'x',referenceImages:[png],inputReference:png}),/不能带首尾帧/);
  assert.equal(videoRequest({type:'多模态',textPrompt:Object.fromEntries(['integrated_multimodal_description','overall_soundscape','non_diegetic_music'].map(key=>[key,shot.text_to_video_prompt[key]])),duration:5,aspectRatio:p.aspect_ratio,referenceImages:[png],packedPrompt:result.content.prompt}).mode,'reference');
});
test('场景参考图可人工导入，文字与图片操作共用项目任务和媒体存储',async()=>{
  const home=await mkdtemp(join(tmpdir(),'meiji-scene-image-'));let runtime;
  try{
    const {p,scene}=withScene();scene.reference_image.address='';scene.reference_image.node_state.status='empty';
    runtime=await createAppRuntime({home});const model=await runtime.repository.create(p);
    // 真实一像素PNG，只验证导入，不调用外部图片服务。
    const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI5sAAAAASUVORK5CYII=';
    const result=await runtime.tasks.command({type:'manual-edit',project_id:p.id,business_type:'scene-image',target_id:scene.id,content:{data},request_id:crypto.randomUUID()});
    await runtime.tasks.idle(p.id);const snapshot=model.read(),task=snapshot.tasks.find(item=>item.id===result.task_id);
    assert.equal(task.task_status,'completed',task.end_reason);assert.equal(isNodeCurrent(snapshot,'scene-image',scene.id),true);
  }finally{await runtime?.dispose();await rm(home,{recursive:true,force:true});}
});
test('人物与场景共同编排：人物在前场景在后，一图一职责，发送顺序与已保存编排一致',async()=>{
  const {p,e,scene,snapshot}=withScene(),shot=e.shot_list.shots[0];
  const person=emptyCharacterModel({name:'父亲'});person.costume_images[0].address='father.png';
  p.character_library.characters.push(person);shot.on_screen_characters=[{character_id:person.id,costume_id:''}];
  const read=[];
  const handler=createVideoPromptHandler({media:{validate:async()=>{},read:async address=>{read.push(address);return Buffer.from(address);}}});
  const result=await handler({snapshot,task:taskFixture(p,'multimodal',shot.id),signal:new AbortController().signal});
  assert.deepEqual(read,['father.png','room.png']);
  assert.deepEqual(result.content.reference_images.map(row=>row.address),read);
  assert.match(result.content.prompt,/第1张参考图："父亲"/);
  assert.match(result.content.prompt,/<Subject 2> 是第2张参考图中的场景"老宅客厅"/);
  const refs=read.map(address=>`data:image/png;base64,${Buffer.from(address).toString('base64')}`);
  const request=videoRequest({type:'多模态',textPrompt:Object.fromEntries(['integrated_multimodal_description','overall_soundscape','non_diegetic_music'].map(key=>[key,shot.text_to_video_prompt[key]])),duration:5,aspectRatio:p.aspect_ratio,referenceImages:refs,packedPrompt:result.content.prompt});
  const body=videoPayload({model:'MiniMax-H3',...request});
  assert.deepEqual(body.images,refs);assert.equal(body.first_frame,undefined);
  assert.match(body.prompt,/木门与窗户相对/);assert.equal(scene.reference_image.address,'room.png');
});
test('v20到v21事务迁移保留正文、媒体与ID，缺场景绑定节点过期，第二次启动不重复改写',async()=>{
  const home=await mkdtemp(join(tmpdir(),'meiji-scene-migration-'));let repo;
  try{
    repo=new ModelRepository(home);const p=projectFixture();await repo.create(p);await repo.close();
    const legacy=structuredClone(p);delete legacy.scene_library;
    for(const e of legacy.episodes){delete e.scene_catalog;for(const shot of e.shot_list.shots){delete shot.scene_id;delete shot.scene_state;delete shot.scene_transition;}}
    const db=new DatabaseSync(join(home,'meiji.sqlite'));db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(legacy),p.id);db.exec('DELETE FROM schema_migrations WHERE version=21; PRAGMA user_version=20');db.close();
    repo=new ModelRepository(home);const snap=(await repo.open(p.id)).read(),shot=snap.project.episodes[0].shot_list.shots[0];
    assert.equal(shot.id,p.episodes[0].shot_list.shots[0].id);assert.equal(shot.body,'剧情');assert.equal(shot.video.address,'1.mp4');
    assert.equal(shot.video.node_state.status,'expired');assert.equal(snap.project.episodes[0].shot_list.node_state.status,'expired');
    assert.equal(snap.project.episodes[0].scene_catalog.has_result,false);
    assert.deepEqual(migrateScenes(structuredClone(snap.project)),snap.project);
    await repo.close();repo=new ModelRepository(home);assert.deepEqual((await repo.open(p.id)).read(),snap);
  }finally{await repo?.close();await rm(home,{recursive:true,force:true});}
});
test('面板在大纲后展示场景选择，已有场景展示共用资料及单张参考图操作',()=>{
  const {p,scene}=withScene(),dom=new JSDOM('<main></main>'),previous=globalThis.document;
  try{
    globalThis.document=dom.window.document;const root=document.querySelector('main');
    renderTaskPanel(root,{...snapshotFixture(),project:p},{session_id:'s',view:{page:'episode',episode_id:p.episodes[0].id,tab:'script'},refresh:async()=>{},paint:()=>{},onError:()=>{}});
    const outline=root.querySelector('[data-business=outline]'),scenes=root.querySelector('[data-business=episode-scenes]');
    assert.equal(outline.nextElementSibling,scenes);assert.match(root.querySelector(`[data-scene-id="${scene.id}"]`).textContent,/木门与窗户/);
    const image=root.querySelector('[data-business=scene-image]');assert.ok(image.querySelector('img'));
    assert.ok([...image.querySelectorAll('button')].some(button=>button.textContent==='人工编辑'));
  }finally{globalThis.document=previous;dom.window.close();}
});
