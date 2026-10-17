import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { projectFixture, snapshotFixture } from './fixtures/project.js';
import { mergeCharacters } from '../shared/collection-identity.js';
import { stampDependencyHash, dependencyHash, expireDownstream } from '../shared/node-dependencies.js';
import { videoType } from '../shared/video-inputs.js';
import { assertProgramReview } from '../shared/node-state.js';
import { validateCommand } from '../shared/task_contract.js';
import { renderTaskPanel } from '../client/task-panel.js';

async function fixture(run, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-video-v16-'));
  let runtime;
  try {
    const file = join(home, 'source.mp4');
    const generated = spawnSync('ffmpeg', ['-y','-v','error','-f','lavfi','-i','color=c=red:s=32x32:d=4','-c:v','libx264','-pix_fmt','yuv420p',file]);
    assert.equal(generated.status, 0, generated.stderr.toString());
    const bytes = await readFile(file), calls = [];
    runtime = await createAppRuntime({ home, gateway: {
      chat: async input => { if (options.chat) return options.chat(input); throw Error('视频编排不得调用文本模型'); },
      submitVideo: async input => { calls.push(input); return { id: 'v16' }; },
      retrieveVideo: async () => options.retrieve ? options.retrieve(bytes) : bytes,
    } });
    const p = projectFixture(), episode = p.episodes[0];
    for (const shot of episode.shot_list.shots) {
      shot.text_to_video_prompt.overall_soundscape = 'Wind.';
      shot.text_to_video_prompt.non_diegetic_music = 'None.';
    }
    const imageFile = join(home, 'image.png');
    const imageResult = spawnSync('ffmpeg',['-y','-v','error','-i',file,'-frames:v','1',imageFile]);
    assert.equal(imageResult.status, 0, imageResult.stderr.toString());
    const image = await runtime.media.put(p.id, await readFile(imageFile), 'png');
    const oldVideo = await runtime.media.put(p.id, bytes, 'mp4');
    for (const shot of episode.shot_list.shots) { shot.video.address = oldVideo.address; shot.last_frame.address = image.address; }
    p.character_library.characters = mergeCharacters(p, [{ name:'甲',gender:'女',era:'现代',position:'',age_range:'',body_type:'',hairstyle:'',signature_props:[],immutable_traits:[],costumes:[] }]).characters;
    const person = p.character_library.characters[0];
    person.costume_images[0].address = image.address; person.costume_images[0].node_state.status = 'generated';
    const snapshot = { project:p, tasks:[], steps:[] };
    function stamp() {
      stampDependencyHash(snapshot,'project-characters',p.id);
      stampDependencyHash(snapshot,'costume-image',person.id);
      stampDependencyHash(snapshot,'shots',episode.id);
      for(const shot of episode.shot_list.shots) for(const b of ['seconds','storyboard','first-last-frame','multimodal','video','tail']) stampDependencyHash(snapshot,b,shot.id);
    }
    stamp();
    await options.setup?.({ p, episode, person, image, stamp });
    const model = await runtime.repository.create(p);
    const submit = async (shot = episode.shot_list.shots[0], extra = {}) => {
      const result = await runtime.tasks.command({ type:'submit', project_id:p.id, request_id:crypto.randomUUID(), business_type:'video', target_id:shot.id, action:'regenerate', ...extra });
      await runtime.tasks.idle(p.id);
      return model.readAll().tasks.find(task => task.id === result.task_id);
    };
    await run({runtime,p,episode,person,model,calls,submit,bytes,image});
  } finally { await runtime?.dispose(); await rm(home,{recursive:true,force:true}); }
}

for (const mode of ['文生','首尾帧','多模态']) test(`真实视频链 ${mode}：执行时定型、程序编排零文本调用、配对提交`, () => fixture(async ({p,episode,model,calls,submit,runtime}) => {
  const target = mode === '文生' ? episode.shot_list.shots[0] : episode.shot_list.shots[1];
  const task = await submit(target);
  assert.equal(task.task_status,'completed',task.end_reason);
  const shot = model.readAll().project.episodes[0].shot_list.shots.find(s=>s.id===target.id);
  assert.equal(shot.video_generation_type,mode);
  assert.equal(shot.video.node_state.status,'generated'); assert.equal(shot.last_frame.node_state.status,'generated');
  assert.notEqual(shot.video.address,target.video.address); assert.notEqual(shot.last_frame.address,target.last_frame.address);
  await runtime.media.validate(shot.last_frame.address,p.id,'image');
  const tasks = model.readAll().tasks.filter(t=>t.group_id===task.group_id).sort((a,b)=>a.group_seq-b.group_seq);
  assert.deepEqual(tasks.map(t=>t.business_type),mode==='文生'?['video']:[mode==='首尾帧'?'first-last-frame':'multimodal','video']);
  assert.deepEqual(model.readAll().steps.filter(st=>st.task_id===task.id).map(st=>st.kind),['precheck','generate','apply','review']);
  assert.equal(calls.length,1);
  assert.equal(calls[0].mode,mode==='文生'?'text':mode==='首尾帧'?'first_frame':'reference');
  assert.equal(Boolean(calls[0].inputReference),mode==='首尾帧');
  assert.equal(Boolean(calls[0].referenceImages),mode==='多模态');
  if(mode==='多模态') assert.equal(calls[0].referenceImages.length,1);
  if(mode!=='文生') {
    const packed = mode==='首尾帧' ? shot.first_last_frame_prompt : shot.multimodal_prompt;
    assert.equal(calls[0].prompt, packed.prompt, '实际发送必须采用已保存编排正文');
    if(mode==='多模态') assert.match(calls[0].prompt,/<Subject 1> 是 <Picture 1> 中的"甲"\(S1\)/);
  }
}, { setup:({episode,person,stamp})=>{
  if(mode==='多模态') {
    episode.shot_list.shots[1].on_screen_characters=[{character_id:person.id,costume_id:''}];
    // 多模态后镜不依赖前镜尾帧，即使该尾帧失效也应成功。
    episode.shot_list.shots[0].last_frame.node_state.status='expired'; episode.shot_list.shots[0].last_frame.node_state.reason='缺尾帧';
  }
  for(const shot of episode.shot_list.shots) shot.first_last_frame_prompt.node_state.status='empty';
  stamp();
} }));

test('有角色缺图阻断视频；改为无人后继续重新判型，不复制多模态任务',()=>fixture(async({runtime,p,episode,model,calls,submit})=>{
  const target=episode.shot_list.shots[0];
  const task=await submit(target);
  assert.equal(task.task_status,'cancelled');assert.equal(calls.length,0);
  const failed=model.readAll().tasks.find(t=>t.task_status==='rejected');assert.equal(failed.business_type,'multimodal');assert.match(failed.end_reason,/定妆照/);
  const old=model.readAll().tasks;
  await model.update('change-binding',{},s=>{
    const shot=s.project.episodes[0].shot_list.shots[0];shot.on_screen_characters=[];
    stampDependencyHash(s,shot.id);stampDependencyHash(s,'seconds',shot.id);stampDependencyHash(s,'storyboard',shot.id);
  });
  const group=await runtime.tasks.command({type:'continue-group',project_id:p.id,request_id:'resume-new-type',group_id:task.group_id});
  await runtime.tasks.idle(p.id);
  assert.deepEqual(model.readAll().tasks.filter(t=>t.group_id===group.group_id).map(t=>[t.business_type,t.task_status]),[['video','completed']]);
  assert.deepEqual(model.readAll().tasks.filter(t=>old.some(o=>o.id===t.id)),old);assert.equal(calls[0].mode,'text');
},{setup:({episode,person,stamp})=>{
  episode.shot_list.shots[0].on_screen_characters=[{character_id:person.id,costume_id:''}];
  person.costume_images[0].node_state.status='empty';person.costume_images[0].address='';stamp();
}}));

test('视频时长4–15及±5边界由程序审核；独立tail命令拒绝',()=>{
  const p=projectFixture(),shot=p.episodes[0].shot_list.shots[0];shot.duration_seconds=10;
  for(const actual of [5,15]) {shot.actual_duration_seconds=actual;assert.doesNotThrow(()=>assertProgramReview(p,'video',shot.id));}
  for(const actual of [3.9,4.9,15.1]) {shot.actual_duration_seconds=actual;assert.throws(()=>assertProgramReview(p,'video',shot.id),/实测/);}
  assert.throws(()=>validateCommand({type:'submit',project_id:p.id,request_id:'tail',business_type:'tail',target_id:shot.id,action:'regenerate'}),/并入视频/);
});

test('实测不通过共用两次修订；耗尽保存最后视频尾帧配对，成功hash不变',()=>fixture(async({runtime,p,episode,model,calls,submit})=>{
  const realValidate=runtime.media.validate.bind(runtime.media);
  runtime.media.validate=async(...args)=>{const info=await realValidate(...args);return args[2]==='video'?{...info,duration:15+calls.length}:info;};
  const before=structuredClone(model.readAll().project.episodes[0].shot_list.shots[0]);
  const task=await submit();assert.equal(task.task_status,'rejected',task.end_reason);
  const shot=model.readAll().project.episodes[0].shot_list.shots[0];
  assert.equal(calls.length,3);assert.match(calls[1].prompt,/Revision instructions:[\s\S]*实测 16/);assert.match(calls[2].prompt,/实测 17/);
  assert.equal(shot.video.node_state.status,'rejected');assert.equal(shot.last_frame.node_state.status,'rejected');
  assert.equal(shot.actual_duration_seconds,18);assert.notEqual(shot.video.address,before.video.address);assert.notEqual(shot.last_frame.address,before.last_frame.address);
  assert.equal(shot.video.node_state.dependency_hash,before.video.node_state.dependency_hash);assert.equal(shot.last_frame.node_state.dependency_hash,before.last_frame.node_state.dependency_hash);
  assert.deepEqual(model.readAll().project.episodes[0].assembly,episode.assembly);
}));

for(const failure of ['截帧文件失败','取消']) test(`${failure}保留旧视频/尾帧/实测值，不重复生成`,()=>fixture(async({runtime,p,model,calls,submit})=>{
  const before=model.readAll().project.episodes[0].shot_list.shots[0];
  if(failure==='截帧文件失败') {
    const realPath=runtime.media.path.bind(runtime.media);let validated=false;
    const validate=runtime.media.validate.bind(runtime.media);runtime.media.validate=async(...args)=>{const result=await validate(...args);if(args[2]==='video')validated=true;return result;};
    runtime.media.path=(address,id)=>validated&&address.endsWith('.mp4')?'/missing-video-file':realPath(address,id);
    assert.equal((await submit()).task_status,'failed');
  } else {
    const realPut=runtime.media.put.bind(runtime.media);
    runtime.media.put=async(...args)=>{
      const asset=await realPut(...args);
      if(args[2]==='png') {
        const task=model.readAll().tasks.find(t=>t.task_status==='running');
        await runtime.tasks.command({type:'cancel',project_id:p.id,request_id:'cancel-tail',task_id:task.id});
      }
      return asset;
    };
    assert.equal((await submit()).task_status,'cancelled');
  }
  const after=model.readAll().project.episodes[0].shot_list.shots[0];
  assert.equal(calls.length,1);assert.equal(after.video.address,before.video.address);assert.deepEqual(after.last_frame,before.last_frame);assert.equal(after.actual_duration_seconds,before.actual_duration_seconds);
}));

test('人工导入无需文本节点，同任务校验并保存视频和尾帧',()=>fixture(async({runtime,p,model,bytes,calls})=>{
  const shot=p.episodes[0].shot_list.shots[0];
  await model.update('clear-text',{},s=>{s.project.episodes[0].shot_list.shots[0].text_to_video_prompt.node_state.status='empty';});
  const result=await runtime.tasks.command({type:'manual-edit',project_id:p.id,request_id:'import',business_type:'video',target_id:shot.id,content:{data:'data:video/mp4;base64,'+bytes.toString('base64')}});
  await runtime.tasks.idle(p.id);
  const after=model.readAll();assert.equal(after.tasks.find(t=>t.id===result.task_id).task_status,'completed');
  assert.equal(calls.length,0);assert.equal(after.project.episodes[0].shot_list.shots[0].actual_duration_seconds,4);
  await runtime.media.validate(after.project.episodes[0].shot_list.shots[0].last_frame.address,p.id,'image');
}));

test('镜头表已指定角色，执行视频前按绑定插入多模态，组内序号唯一且合片一次',async()=>{
  await fixture(async({runtime,p,episode,model,calls})=>{
    const target=episode.shot_list.shots[0];
    const group=await runtime.tasks.command({type:'submit-group',project_id:p.id,request_id:'late-binding',group_type:'episode-film',episode_id:episode.id,shot_id:target.id,action:'generate'});
    await runtime.tasks.idle(p.id);
    const tasks=model.readAll().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
    assert.deepEqual(tasks.filter(t=>t.business_type!=='assembly').map(t=>t.business_type),['seconds','storyboard','multimodal','video']);
    assert.ok(tasks.every(t=>t.task_status==='completed'),tasks.map(t=>t.end_reason).join(';'));
    assert.equal(new Set(tasks.map(t=>t.group_seq)).size,tasks.length);
    assert.equal(calls[0].mode,'reference');assert.ok(tasks.filter(t=>t.business_type==='assembly').length<=1);
  },{setup:({episode,person})=>{episode.shot_list.shots[0].on_screen_characters=[{character_id:person.id,costume_id:''}];},chat:({task,step})=>{
    if(step.kind==='review')return {是否通过:true, "类型": "",原因:''};
    if(task.business_type==='seconds')return {end_state:'甲站在门口，动作已结束。',pending_actions:'',pending_dialogue:'',continuing_audio:'风声',storyboard:[{time_range:'0–5s',action:'甲站立',camera:'固定',space:'门口',audio:'风声',handoff:'站立',dialogue:[]}]};
    return 'integrated_multimodal_description:\nA woman stands.\noverall_soundscape:\nWind.\nnon_diegetic_music:\nNone.';
  }});
});

test('依赖按实际类型传播：多模态不依赖前尾帧，首尾帧不依赖角色图片，镜头重排改变类型',()=>{
  const snapshot=snapshotFixture(),p=snapshot.project,e=p.episodes[0],[first,second]=e.shot_list.shots;
  const person=mergeCharacters(p,[{name:'甲',gender:'女',era:'现代',position:'',age_range:'',body_type:'',hairstyle:'',signature_props:[],immutable_traits:[],costumes:[]}]).characters[0];
  p.character_library.characters=[person];person.costume_images[0].address='a.png';person.costume_images[0].node_state.status='generated';
  second.on_screen_characters=[{character_id:person.id,costume_id:''}];
  for(const b of ['multimodal','video'])stampDependencyHash(snapshot,b,second.id);
  const hash=dependencyHash(snapshot,'video',second.id);
  first.last_frame.address='changed-tail.png';expireDownstream(snapshot,'tail',first.id);
  assert.equal(dependencyHash(snapshot,'video',second.id),hash);assert.equal(second.video.node_state.status,'generated');
  person.costume_images[0].address='b.png';expireDownstream(snapshot,'costume-image',person.id);
  assert.equal(second.video.node_state.status,'expired');assert.equal(first.video.node_state.status,'generated');
  second.on_screen_characters=[];second.video.node_state.status='generated';second.video.node_state.reason='';
  second.first_last_frame_prompt.node_state.status='generated';second.first_last_frame_prompt.node_state.reason='';
  for(const b of ['first-last-frame','video'])stampDependencyHash(snapshot,b,second.id);
  const firstFrameHash=dependencyHash(snapshot,'video',second.id);
  person.costume_images[0].address='c.png';expireDownstream(snapshot,'costume-image',person.id);
  assert.equal(second.video.node_state.status,'generated');assert.equal(dependencyHash(snapshot,'video',second.id),firstFrameHash);
  first.last_frame.address='new-tail.png';expireDownstream(snapshot,'tail',first.id);
  assert.equal(second.video.node_state.status,'expired');assert.equal(second.first_last_frame_prompt.node_state.status,'expired');
  second.sequence=1;first.sequence=2;assert.equal(videoType(e,second),'文生');
  assert.notEqual(dependencyHash(snapshot,'video',second.id),firstFrameHash);
});

test('界面显示适用程序编排；尾帧是视频内步骤，失败时可重新提取',async()=>{
  const dom=new JSDOM('<main></main>'),previous={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;
  try{
    const snapshot=snapshotFixture(),episode=snapshot.project.episodes[0],shot=episode.shot_list.shots[1];
    shot.first_last_frame_prompt.prompt='';shot.first_last_frame_prompt.node_state.status='empty';
    const root=document.querySelector('main');renderTaskPanel(root,snapshot,{session_id:'test',view:{page:'episode',episode_id:episode.id,shot_id:shot.id,tab:'film'},refresh:async()=>{},paint:()=>{},onError:()=>{}});
    const pack=root.querySelector('[data-business="first-last-frame"]'),video=root.querySelector('[data-business="video"]'),tail=video.querySelector('[data-business="tail"]');
    assert.ok(pack);assert.deepEqual([...pack.querySelectorAll('button')].map(button=>button.textContent),['执行编排','任务历史']);
    assert.equal(pack.querySelector('input'),null);
    assert.ok(tail);assert.equal(tail.querySelector('.node-ui'),null);assert.equal(tail.querySelector('button'),null);
    shot.last_frame.address='';shot.last_frame.node_state.status='empty';shot.last_frame.node_state.reason='';
    snapshot.tasks=[{business_type:'video',target_id:shot.id,task_status:'failed',end_reason:'截帧失败',queue_order:1}];
    renderTaskPanel(root,snapshot,{session_id:'test',view:{page:'episode',episode_id:episode.id,shot_id:shot.id,tab:'film'},refresh:async()=>{},paint:()=>{},onError:()=>{}});
    const failed=root.querySelector('[data-business="video"] [data-business="tail"]');
    assert.equal(failed.querySelector('.node-ui'),null);
    assert.deepEqual([...failed.querySelectorAll('button')].map(button=>button.textContent),['重新提取']);
    const failedVideo = root.querySelector('[data-business="video"]');
    assert.equal(failedVideo.querySelector('.node-ui-task-status').textContent, '最新任务：失败');
    assert.equal(failedVideo.querySelector('.node-ui-failure').textContent, '失败原因：截帧失败');
    assert.match(root.textContent,/视频类型：首尾帧/);
    shot.first_last_frame_prompt.prompt='compiled';shot.first_last_frame_prompt.seconds=5;shot.first_last_frame_prompt.size='576x1024';shot.first_last_frame_prompt.input_reference='1.png';
    renderTaskPanel(root,snapshot,{session_id:'test',view:{page:'episode',episode_id:episode.id,shot_id:shot.id,tab:'film'},refresh:async()=>{},paint:()=>{},onError:()=>{}});
    const fields = [...root.querySelector('[data-business="first-last-frame"] .h3-request').querySelectorAll('p')].map(node => node.textContent);
    assert.deepEqual(fields.map(text => text.split(': ')[0]), ['mode', 'prompt', 'duration', 'resolution', 'ratio', 'first_frame']);
    assert.equal(fields[0], 'mode: 首尾帧');
    assert.equal(fields[3], 'resolution: 768P');
    assert.equal(fields[4], 'ratio: adaptive');
    assert.match(fields[5], /^first_frame: data:image\/png;base64,/);
    assert.equal(root.querySelector('[data-business="first-last-frame"]').textContent.includes('model'), false);
    shot.video_generation_type='多模态';shot.multimodal_prompt.prompt='mapped';shot.multimodal_prompt.seconds=8;shot.multimodal_prompt.size='576x1024';shot.multimodal_prompt.reference_images=[{address:'a.png'},{address:'b.jpg'}];
    renderTaskPanel(root,snapshot,{session_id:'test',view:{page:'episode',episode_id:episode.id,shot_id:shot.id,tab:'film'},refresh:async()=>{},paint:()=>{},onError:()=>{}});
    const multimodal = [...root.querySelector('[data-business="multimodal"] .h3-request').querySelectorAll('p')].map(node => node.textContent);
    assert.deepEqual(multimodal.map(text => text.split(': ')[0]), ['mode', 'prompt', 'duration', 'resolution', 'ratio', 'images']);
    assert.equal(multimodal[0], 'mode: 多模态');
    assert.equal(multimodal[2], 'duration: 8');
    assert.equal(multimodal[4], 'ratio: 9:16');
    assert.equal(multimodal[5], 'images: data:image/png;base64,…\ndata:image/jpeg;base64,…');
    const copy = root.querySelector('[data-business="multimodal"] .section-titles .meiji-log-copy');
    assert.equal(copy.textContent, '复制');
    let copied = '';
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    copy.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    assert.deepEqual(JSON.parse(copied), { mode: '多模态', prompt: 'mapped', duration: 8, resolution: '768P', ratio: '9:16', images: ['data:image/png;base64,…', 'data:image/jpeg;base64,…'] });
    const calls=[];
    globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body).command);return {ok:true,json:async()=>({})};};
    failed.querySelector('button').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(calls[0].type,'manual-edit');assert.equal(calls[0].business_type,'video');assert.equal(calls[0].target_id,shot.id);assert.equal(calls[0].content.address,shot.video.address);
  }finally{globalThis.document=previous.document;globalThis.fetch=previous.fetch;dom.window.close();}
});
