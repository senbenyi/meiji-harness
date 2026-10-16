import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectFixture } from './fixtures/project.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { TaskService } from '../server/flow/tasks/task-manager.js';
import { commitContent } from '../server/handlers/content.js';
import { groupDetail } from '../server/data/task-store.js';

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
    if(step.kind==='review') {const fail=(control.reject&&task.business_type==='seconds')||(control.revise&&task.business_type==='seconds'&&step.round===0);return {result:{是否通过:!fail,原因:fail?'需要修订':''}};}
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
 const tasks=model.read().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
  assert.deepEqual(tasks.map(t=>t.business_type),['seconds','storyboard','video','seconds','storyboard','first-last-frame','video','assembly']);
 assert.ok(tasks.every(t=>t.task_status==='completed'));
 const first=p.episodes[0].shot_list.shots[0].id;
 assert.deepEqual(events.filter(e=>e[0]===first).map(e=>e.slice(1)),[['seconds','generate'],['seconds','review'],['seconds','revise'],['seconds','review'],['seconds','review'],['storyboard','generate'],['storyboard','review'],['video','generate'],['video','apply'],['video','review']]);
 assert.equal(model.read().project.episodes[0].shot_list.shots[0].actual_duration_seconds,5.2);assert.equal(model.read().project.episodes[0].shot_list.shots[0].duration_seconds,5);
}));

test('不同单镜组正常排队，由最后收尾的组派生一次合片',()=>fixture(async({p,model,service,control,command})=>{
 let release;control.gate=new Promise(resolve=>release=resolve);
 try {
  const [firstShot,secondShot]=p.episodes[0].shot_list.shots;
  const first=await service.command({...command,action:'generate',shot_id:firstShot.id});
  const second=await service.command({...command,action:'generate',request_id:'second-shot',shot_id:secondShot.id});
  assert.deepEqual(model.read().tasks.filter(t=>t.group_id===first.group_id).map(t=>t.business_type),['video']);
  assert.deepEqual(model.read().tasks.filter(t=>t.group_id===second.group_id).map(t=>t.business_type),['video']);
  await assert.rejects(service.command({type:'submit',project_id:p.id,request_id:'manual-assembly',business_type:'assembly',target_id:p.episodes[0].id,action:'regenerate'}),{code:'TASK_CONFLICT'});
  release();await service.idle(p.id);
  const tasks=model.read().tasks;
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
  const before=model.read();
  await assert.rejects(service.command(command),{code:'TASK_CONFLICT'});
  assert.equal(model.read().tasks.length,before.tasks.length);
  assert.equal(model.read().groups.length,before.groups.length);
 }finally{release();await service.idle(p.id);}
},allCurrent));

test('每秒审核未通过停止后序，继续保留旧终态并完整接续',()=>fixture(async({p,model,service,control,command})=>{
 control.reject=true;const first=await service.command(command);await service.idle(p.id);const old=model.read().tasks;
 assert.equal(old[0].task_status,'rejected');assert.ok(old.slice(1).every(t=>t.task_status==='cancelled'));
 control.reject=false;const next=await service.command({type:'continue-group',project_id:p.id,request_id:'continue',group_id:first.group_id});
 assert.equal(next.task_ids.length,6);await service.idle(p.id);
 assert.deepEqual(model.read().tasks.slice(0,6),old);assert.ok(model.read().tasks.slice(6).every(t=>t.task_status==='completed'));
}));

test('单镜成片范围/意见及跨集拒绝，无其他镜头任务',()=>fixture(async({p,model,service,command})=>{
 const shot=p.episodes[0].shot_list.shots[0];const group=await service.command({...command,shot_id:shot.id,opinion:'强调动作'});await service.idle(p.id);
 const tasks=model.read().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);assert.equal(tasks.length,3);assert.ok(tasks.every(t=>t.target_id===shot.id&&t.opinion==='强调动作'));
 assert.deepEqual(model.read().groups[0].shot_ids,[shot.id]);
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
 const tasks=model.read().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
 assert.deepEqual(tasks.map(t=>t.business_type),['assembly']);
 assert.equal(tasks[0].target_id,p.episodes[0].id);
 assert.equal(tasks[0].task_status,'completed',tasks[0].end_reason);
 assert.deepEqual(await service.command(request),group);
 assert.equal((await service.command({...request,request_id:'again'})).group_id,null);
 assert.equal(model.read().tasks.length,1);
},allCurrent));

test('单镜重做后其他视频已有效则追加合片，不代生成其他镜头',()=>fixture(async({p,model,service,command})=>{
 const shot=p.episodes[0].shot_list.shots[1];
 const group=await service.command({...command,shot_id:shot.id});await service.idle(p.id);
 const tasks=model.read().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
 assert.deepEqual(tasks.map(t=>t.business_type),['seconds','storyboard','video','assembly']);
 assert.ok(tasks.slice(0,-1).every(t=>t.target_id===shot.id));
 assert.ok(tasks.every(t=>t.task_status==='completed'),tasks.map(t=>t.end_reason).join(';'));
},allCurrent));

test('合片失败继续只创建新组合片，旧任务和步骤保持终态',()=>fixture(async({p,model,service,control,command})=>{
 control.failAssembly=true;
 const first=await service.command(command);await service.idle(p.id);
 const before=model.read(), members=before.tasks.filter(t=>t.group_id===first.group_id);
 assert.equal(members.at(-1).business_type,'assembly');
 assert.equal(members.at(-1).task_status,'failed');
 assert.equal(groupDetail(model,first.group_id).status,'failed');
 control.failAssembly=false;
 const next=await service.command({type:'continue-group',project_id:p.id,request_id:'assembly-continue',group_id:first.group_id});
 assert.equal(next.task_ids.length,1);
 await service.idle(p.id);
 const after=model.read();
 assert.deepEqual(after.tasks.filter(t=>t.group_id===first.group_id),members);
 assert.deepEqual(after.steps.filter(st=>members.some(t=>t.id===st.task_id)),before.steps);
 assert.equal(after.tasks.at(-1).business_type,'assembly');
 assert.equal(after.tasks.at(-1).task_status,'completed',after.tasks.at(-1).end_reason);
 assert.equal(groupDetail(model,next.group_id).status,'completed');
}));

test('缺少或不匹配的依赖 hash 不被当作已有有效视频跳过',()=>fixture(async({p,model,service,command})=>{
 const group=await service.command({...command,action:'generate'});await service.idle(p.id);
 const tasks=model.read().tasks.filter(t=>t.group_id===group.group_id).sort((a,b)=>a.group_seq-b.group_seq);
 assert.deepEqual(tasks.map(t=>t.business_type),['video','first-last-frame','video','assembly']);
 assert.ok(tasks.every(t=>t.task_status==='completed'),tasks.map(t=>t.end_reason).join(';'));
},(p,originals)=>{
 allCurrent(p,originals);
 p.episodes[0].shot_list.shots[0].video.node_state.dependency_hash='';
}));
