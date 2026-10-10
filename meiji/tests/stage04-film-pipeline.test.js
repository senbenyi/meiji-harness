import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectFixture } from './fixtures/project.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { TaskService } from '../server/flow/tasks/task-service.js';
import { commitContent } from '../server/handlers/content.js';

async function fixture(work) {
 const home=await mkdtemp(join(tmpdir(),'meiji-film-pipeline-'));let service;
 try {
  const p=projectFixture(), originals=structuredClone(p.剧集[0].镜头表.镜头), events=[];
  for(const shot of p.剧集[0].镜头表.镜头)for(const b of ['每秒分镜','文本提示词','视频','尾帧'])shot[b].状态='empty';
  const repo=new ModelRepository(home), model=await repo.create(p), control={reject:false,revise:false};
  service=new TaskService({repository:repo,commitOutput:commitContent,execute:async({task,step})=>{
   events.push([task.target_id,task.business_type,step.kind]);
   if(step.kind==='review') {const fail=control.reject||(control.revise&&task.business_type==='seconds'&&step.round===0);return {result:{通过:!fail,原因:fail?'需要修订':''}};}
   const shot=originals.find(s=>s.id===task.target_id);
   if(task.business_type==='seconds')return {content:{衔接上一镜方式:shot.每秒分镜.衔接上一镜方式,内容:shot.每秒分镜.内容}};
   if(task.business_type==='storyboard')return {content:{正文:shot.文本提示词.正文,环境声:'',配乐:''}};
   return {content:{地址:task.business_type==='video'?'test.mp4':'tail.png',...(task.business_type==='video'?{实际时长秒:5.2}:{})}};
  }});
  const command={type:'submit-group',project_id:p.id,request_id:'film',group_type:'episode-film',episode_id:p.剧集[0].id};
  await work({p,model,service,events,control,command});
 } finally {await service?.dispose();await rm(home,{recursive:true,force:true});}
}

test('本集成片逐镜完整链：每秒审核通过后提示词/视频/尾帧，再下一镜',()=>fixture(async({p,model,service,events,control,command})=>{
 control.revise=true;const group=await service.command(command);await service.idle(p.id);
 const tasks=model.read().tasks.filter(t=>t.group_id===group.group_id);
 assert.deepEqual(tasks.map(t=>t.business_type),['seconds','storyboard','video','tail','seconds','storyboard','video','tail']);
 assert.ok(tasks.every(t=>t.task_status==='completed'));
 const first=p.剧集[0].镜头表.镜头[0].id;
 assert.deepEqual(events.filter(e=>e[0]===first).map(e=>e.slice(1)),[['seconds','generate'],['seconds','review'],['seconds','revise'],['seconds','review'],['storyboard','generate'],['storyboard','review'],['video','generate'],['tail','generate']]);
 assert.equal(model.read().project.剧集[0].镜头表.镜头[0].实际时长秒,5.2);assert.equal(model.read().project.剧集[0].镜头表.镜头[0].时长秒,5);
}));

test('每秒审核未通过停止后序，继续保留旧终态并完整接续',()=>fixture(async({p,model,service,control,command})=>{
 control.reject=true;const first=await service.command(command);await service.idle(p.id);const old=model.read().tasks;
 assert.equal(old[0].task_status,'rejected');assert.ok(old.slice(1).every(t=>t.task_status==='superseded'));
 control.reject=false;const next=await service.command({type:'continue-group',project_id:p.id,request_id:'continue',group_id:first.group_id});
 assert.equal(next.task_ids.length,8);await service.command({type:'start-queued',project_id:p.id,request_id:'start',task_id:next.task_ids[0]});await service.idle(p.id);
 assert.deepEqual(model.read().tasks.slice(0,8),old);assert.ok(model.read().tasks.slice(8).every(t=>t.task_status==='completed'));
}));

test('单镜成片范围/意见及跨集拒绝，无其他镜头任务',()=>fixture(async({p,model,service,command})=>{
 const shot=p.剧集[0].镜头表.镜头[0];const group=await service.command({...command,shot_id:shot.id,opinion:'强调动作'});await service.idle(p.id);
 const tasks=model.read().tasks.filter(t=>t.group_id===group.group_id);assert.equal(tasks.length,4);assert.ok(tasks.every(t=>t.target_id===shot.id&&t.opinion==='强调动作'));
 assert.deepEqual(model.read().groups[0].shot_ids,[shot.id]);
 await assert.rejects(service.command({...command,request_id:'invalid',shot_id:p.id}),/不属于当前剧集/);
}));
