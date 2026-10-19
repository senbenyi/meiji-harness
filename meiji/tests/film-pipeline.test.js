import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectFixture, snapshotFixture } from "./fixtures/project.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { commitContent } from "../server/handlers/content.js";
import { groupDetail } from "../server/data/task-store.js";
import { spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { stampDependencyHash, dependencyHash, expireDownstream } from "../shared/node-dependencies.js";
import { videoType } from "../shared/video-inputs.js";
import { assertProgramReview } from "../shared/node-state.js";
import { validateCommand } from "../shared/task_contract.js";
import { renderTaskPanel } from "../client/task-panel.js";

describe("film-pipeline", () => {
  // 已结束的任务组只在数据库：测试经 readAll 合并历史后查询。
  const full = model => ({ read: () => model.readAll() });
  async function fixture(work, configure = () => {}) {
   const home=await mkdtemp(join(tmpdir(),'meiji-film-pipeline-'));let service;
   try {
    const p=projectFixture(), originals=structuredClone(p.episodes[0].shot_list.shots), events=[];
     for(const shot of p.episodes[0].shot_list.shots)for(const b of ['seconds_storyboard','text_to_video_prompt','video','last_frame'])shot[b].node_state.status='empty';
     configure(p, originals);
     const repo=new ModelRepository(home), model=await repo.create(p), control={reject:false,revise:false,failAssembly:false};
    service=new TaskService({repository:repo,commitOutput:commitContent,execute:async({task,step})=>{
      if(control.gate)await control.gate;
      events.push([task.target_id,task.business_type,step.kind]);
      if(step.kind==='precheck')return {result:{passed:true}};
      if(step.kind==='review') {const fail=(control.reject&&task.business_type==='seconds')||(control.revise&&task.business_type==='seconds'&&step.round===0);return {result:{是否通过:!fail, "类型": (!fail) ? "" : "模型问题",原因:fail?'需要修订':''}};}
      if(task.business_type==='assembly') {
       if(control.failAssembly)throw new Error('合片失败');
     return {content:{address:'film-new.mp4'},result:{duration:10.4}};
      }
     if (task.business_type === 'first-last-frame') return {content:{model:'elysium-video',prompt:'compiled',seconds:5,size:'1024x576',input_reference:'tail.png'}};
     const shot=originals.find(s=>s.id===task.target_id);
     if(task.business_type==='seconds')return {content:{storyboard:shot.seconds_storyboard.storyboard}};
     if(task.business_type==='storyboard')return {content:{integrated_multimodal_description:shot.text_to_video_prompt.integrated_multimodal_description,overall_soundscape:'',non_diegetic_music:''}};
     return {content:{address:task.business_type==='video'?'test.mp4':'tail.png',...(task.business_type==='video'?{actual_duration_seconds:5.2,last_frame:{address:'tail.png'}}:{})}};
    }});
    const command={type:'submit-group',project_id:p.id,request_id:'film',group_type:'episode-film',episode_id:p.episodes[0].id,action:'regenerate'};
    await work({p,model,service,events,control,command});
   } finally {await service?.dispose();await rm(home,{recursive:true,force:true});}
  }

  test('本集成片逐镜完整链：每秒审核通过后提示词/视频/尾帧，再下一镜',()=>fixture(async({p,model,service,events,control,command})=>{
   control.revise=true;const group=await service.command(command);await service.idle(p.id);
   const tasks=model.readAll().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
    assert.deepEqual(tasks.map(t=>t.business_type),['seconds','storyboard','video','seconds','storyboard','first-last-frame','video','assembly']);
   assert.ok(tasks.every(t=>t.task_status==='completed'));
   const first=p.episodes[0].shot_list.shots[0].id;
   assert.deepEqual(events.filter(e=>e[0]===first).map(e=>e.slice(1)),[['seconds','generate'],['seconds','review'],['seconds','revise'],['seconds','review'],['seconds','review'],['storyboard','generate'],['storyboard','review'],['video','generate'],['video','download'],['video','apply']]);
   assert.equal(model.readAll().project.episodes[0].shot_list.shots[0].actual_duration_seconds,5.2);assert.equal(model.readAll().project.episodes[0].shot_list.shots[0].duration_seconds,5);
  }));

  test('不同单镜组正常排队，由最后收尾的组派生一次合片',()=>fixture(async({p,model,service,control,command})=>{
   let release;control.gate=new Promise(resolve=>release=resolve);
   try {
    const [firstShot,secondShot]=p.episodes[0].shot_list.shots;
    const first=await service.command({...command,action:'generate',shot_id:firstShot.id});
    const second=await service.command({...command,action:'generate',request_id:'second-shot',shot_id:secondShot.id});
    assert.deepEqual(model.readAll().tasks.filter(t=>t.group_id===first.group_id).map(t=>t.business_type),['video']);
    assert.deepEqual(model.readAll().tasks.filter(t=>t.group_id===second.group_id).map(t=>t.business_type),['video']);
    await assert.rejects(service.command({type:'submit',project_id:p.id,request_id:'manual-assembly',business_type:'assembly',target_id:p.episodes[0].id,action:'regenerate'}),{code:'TASK_CONFLICT'});
    release();await service.idle(p.id);
    const tasks=model.readAll().tasks;
    assert.ok(tasks.every(t=>t.task_status==='completed'),tasks.map(t=>t.end_reason).join(';'));
    assert.equal(tasks.filter(t=>t.business_type==='assembly').length,1);
    assert.equal(tasks.at(-1).group_id,second.group_id);
   }finally{release();}
  },(p,originals)=>{
   allCurrent(p,originals);
   for(const shot of p.episodes[0].shot_list.shots){shot.last_frame.node_state.status='expired';shot.last_frame.node_state.reason='等待尾帧';}
  }));

  test('已有独立合片任务时拒绝整集成片，没有残留半组',()=>fixture(async({p,model,service,control,command})=>{
   let release;control.gate=new Promise(resolve=>release=resolve);
   try {
    await service.command({type:'submit',project_id:p.id,request_id:'assembly-alone',business_type:'assembly',target_id:p.episodes[0].id,action:'regenerate'});
    const before=model.readAll();
    await assert.rejects(service.command(command),{code:'TASK_CONFLICT'});
    assert.equal(model.readAll().tasks.length,before.tasks.length);
    assert.equal(model.readAll().groups.length,before.groups.length);
   }finally{release();await service.idle(p.id);}
  },allCurrent));

  test('每秒审核未通过停止后序，继续保留旧终态并完整接续',()=>fixture(async({p,model,service,control,command})=>{
   control.reject=true;const first=await service.command(command);await service.idle(p.id);const old=model.readAll().tasks;
   assert.equal(old[0].task_status,'rejected');assert.ok(old.slice(1).every(t=>t.task_status==='cancelled'));
   control.reject=false;const next=await service.command({type:'continue-group',project_id:p.id,request_id:'continue',group_id:first.group_id});
   assert.equal(next.task_ids.length,6);await service.idle(p.id);
   assert.deepEqual(model.readAll().tasks.slice(0,6),old);assert.ok(model.readAll().tasks.slice(6).every(t=>t.task_status==='completed'));
  }));

  test('单镜成片范围/意见及跨集拒绝，无其他镜头任务',()=>fixture(async({p,model,service,command})=>{
   const shot=p.episodes[0].shot_list.shots[0];const group=await service.command({...command,shot_id:shot.id,opinion:'强调动作'});await service.idle(p.id);
   const tasks=model.readAll().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);assert.equal(tasks.length,3);assert.ok(tasks.every(t=>t.target_id===shot.id&&t.opinion==='强调动作'));
   assert.deepEqual(model.readAll().groups[0].shot_ids,[shot.id]);
   await assert.rejects(service.command({...command,request_id:'invalid',shot_id:p.id}),/不属于当前剧集/);
  }));

  function allCurrent(p, originals) {
   p.episodes[0].shot_list.shots = structuredClone(originals);
   p.episodes[0].assembly.node_state.status = 'expired';
   p.episodes[0].assembly.node_state.reason = '等待合片';
  }

  test('已有逐镜内容只补同组合片，幂等提交与重复点击均不重跑有效合片',()=>fixture(async({p,model,service,command})=>{
   const request={...command,action:'generate'};
   const group=await service.command(request);await service.idle(p.id);
   assert.equal(group.task_ids.length,1);
   const tasks=model.readAll().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
   assert.deepEqual(tasks.map(t=>t.business_type),['assembly']);
   assert.equal(tasks[0].target_id,p.episodes[0].id);
   assert.equal(tasks[0].task_status,'completed',tasks[0].end_reason);
   assert.deepEqual(await service.command(request),group);
   assert.equal((await service.command({...request,request_id:'again'})).group_id,null);
   assert.equal(model.readAll().tasks.length,1);
  },allCurrent));

  test('单镜重做后其他视频已有效则追加合片，不代生成其他镜头',()=>fixture(async({p,model,service,command})=>{
   const shot=p.episodes[0].shot_list.shots[1];
   const group=await service.command({...command,shot_id:shot.id});await service.idle(p.id);
   const tasks=model.readAll().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
   assert.deepEqual(tasks.map(t=>t.business_type),['seconds','storyboard','video','assembly']);
   assert.ok(tasks.slice(0,-1).every(t=>t.target_id===shot.id));
   assert.ok(tasks.every(t=>t.task_status==='completed'),tasks.map(t=>t.end_reason).join(';'));
  },allCurrent));

  test('合片失败继续只创建新组合片，旧任务和步骤保持终态',()=>fixture(async({p,model,service,control,command})=>{
   control.failAssembly=true;
   const first=await service.command(command);await service.idle(p.id);
   const before=model.readAll(), members=before.tasks.filter(t=>t.group_id===first.group_id);
   assert.equal(members.at(-1).business_type,'assembly');
   assert.equal(members.at(-1).task_status,'failed');
   assert.equal(groupDetail(full(model),first.group_id).status,'failed');
   control.failAssembly=false;
   const next=await service.command({type:'continue-group',project_id:p.id,request_id:'assembly-continue',group_id:first.group_id});
   assert.equal(next.task_ids.length,1);
   await service.idle(p.id);
   const after=model.readAll();
   assert.deepEqual(after.tasks.filter(t=>t.group_id===first.group_id),members);
   assert.deepEqual(after.steps.filter(st=>members.some(t=>t.id===st.task_id)),before.steps);
   assert.equal(after.tasks.at(-1).business_type,'assembly');
   assert.equal(after.tasks.at(-1).task_status,'completed',after.tasks.at(-1).end_reason);
   assert.equal(groupDetail(full(model),next.group_id).status,'completed');
  }));

  test('缺少或不匹配的依赖 hash 不被当作已有有效视频跳过',()=>fixture(async({p,model,service,command})=>{
   const group=await service.command({...command,action:'generate'});await service.idle(p.id);
   const tasks=model.readAll().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
   assert.deepEqual(tasks.map(t=>t.business_type),['video','first-last-frame','video','assembly']);
   assert.ok(tasks.every(t=>t.task_status==='completed'),tasks.map(t=>t.end_reason).join(';'));
  },(p,originals)=>{
   allCurrent(p,originals);
   p.episodes[0].shot_list.shots[0].video.node_state.dependency_hash='';
  }));
});

describe("video-chain", () => {
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
    assert.match(shot.video.server_address, /\/videos\/v16\/content$/);
    await runtime.media.validate(shot.last_frame.address,p.id,'image');
    const tasks = model.readAll().tasks.filter(t=>t.group_id===task.group_id).sort((a,b)=>a.group_seq-b.group_seq);
    assert.deepEqual(tasks.map(t=>t.business_type),mode==='文生'?['video']:[mode==='首尾帧'?'first-last-frame':'multimodal','video']);
    assert.deepEqual(model.readAll().steps.filter(st=>st.task_id===task.id).map(st=>st.kind),['precheck','generate','download','apply']);
    assert.equal(calls.length,1);
    assert.equal(calls[0].mode,mode==='文生'?'text':mode==='首尾帧'?'first_frame':'reference');
    assert.equal(Boolean(calls[0].inputReference),mode==='首尾帧');
    assert.equal(Boolean(calls[0].referenceImages),mode==='多模态');
    if(mode==='多模态') assert.equal(calls[0].referenceImages.length,1);
    if(mode!=='文生') {
      const packed = mode==='首尾帧' ? shot.first_last_frame_prompt : shot.multimodal_prompt;
      assert.equal(calls[0].prompt, [shot.video.rules.generate.base, packed.prompt].filter(Boolean).join('\n\n'), '规则来自节点，已保存编排正文保持原文');
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

  test('有角色但缺图时直接文生，保留出镜绑定，不创建多模态任务',()=>fixture(async({episode,model,calls,submit})=>{
    const target=episode.shot_list.shots[0],binding=structuredClone(target.on_screen_characters);
    const task=await submit(target);
    assert.equal(task.task_status,'completed',task.end_reason);assert.equal(calls.length,1);assert.equal(calls[0].mode,'text');
    const snap=model.readAll(),shot=snap.project.episodes[0].shot_list.shots[0];
    assert.deepEqual(shot.on_screen_characters,binding);
    assert.deepEqual(snap.tasks.filter(t=>t.group_id===task.group_id).map(t=>t.business_type),['video']);
  },{setup:({episode,person,stamp})=>{
    episode.shot_list.shots[0].on_screen_characters=[{character_id:person.id,costume_id:''}];
    person.costume_images[0].node_state.status='empty';person.costume_images[0].address='';stamp();
  }}));

  test('视频不做时长业务审核；独立tail命令拒绝',()=>{
    const p=projectFixture(),shot=p.episodes[0].shot_list.shots[0];shot.duration_seconds=10;
    for(const actual of [5,15]) {shot.actual_duration_seconds=actual;assert.doesNotThrow(()=>assertProgramReview(p,'video',shot.id));}
    for(const actual of [3.9,4.9,15.1]) {shot.actual_duration_seconds=actual;assert.doesNotThrow(()=>assertProgramReview(p,'video',shot.id));}
    assert.throws(()=>validateCommand({type:'submit',project_id:p.id,request_id:'tail',business_type:'tail',target_id:shot.id,action:'regenerate'}),/并入视频/);
  });

  test('实测15.1秒保存视频与尾帧，不审核或自动重生成',()=>fixture(async({runtime,model,calls,submit})=>{
    const realValidate=runtime.media.validate.bind(runtime.media);
    runtime.media.validate=async(...args)=>{const info=await realValidate(...args);return args[2]==='video'?{...info,duration:15.1}:info;};
    const task=await submit();assert.equal(task.task_status,'completed',task.end_reason);
    const shot=model.readAll().project.episodes[0].shot_list.shots[0];
    assert.equal(calls.length,1);
    assert.equal(shot.video.node_state.status,'generated');assert.equal(shot.last_frame.node_state.status,'generated');
    assert.equal(shot.actual_duration_seconds,15.1);
    assert.match(shot.video.server_address, /\/videos\/v16\/content$/);
    assert.ok(shot.video.address);
    assert.notEqual(shot.video.address, shot.video.server_address);
    assert.deepEqual(model.readAll().steps.filter(row=>row.task_id===task.id).map(row=>row.kind),['precheck','generate','download','apply']);
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
      return 'integrated_multimodal_description:\n[Shot 1] A woman stands.\noverall_soundscape:\nWind.\nnon_diegetic_music:\nNone.';
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
    second.sequence=1;first.sequence=2;assert.equal(videoType(p,e,second),'文生');
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
      shot.video.node_state.status='rejected';shot.video.node_state.reason='历史时长审核原因';
      renderTaskPanel(root,snapshot,{session_id:'test',view:{page:'episode',episode_id:episode.id,shot_id:shot.id,tab:'film'},refresh:async()=>{},paint:()=>{},onError:()=>{}});
      assert.equal([...root.querySelector('[data-business="video"]').querySelectorAll('button')].some(b=>/^修复|原结果修订/.test(b.textContent)),false);
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
      const people = ['甲', '乙'].map((name, index) => {
        const person = emptyCharacterModel({ name });
        person.costume_images[0].address = ['a.png', 'b.jpg'][index];
        person.costume_images[0].node_state.status = 'generated';
        return person;
      });
      snapshot.project.character_library.characters = people;
      shot.on_screen_characters = people.map(person => ({ character_id: person.id, costume_id: '' }));
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
});
