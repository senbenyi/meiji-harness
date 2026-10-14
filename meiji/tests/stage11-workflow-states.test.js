import { seedQueuedTasks } from './fixtures/queued-tasks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRepository } from '../server/data/model-repository.js';
import { TaskService } from '../server/flow/tasks/task-manager.js';
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from '../server/handlers/handler-registry.js';
import { commitContent } from '../server/handlers/content.js';
import { mergeCharacters } from '../shared/collection-identity.js';
import { primaryCostumeImage } from '../shared/models/character_model.js';
import { projectFixture } from './fixtures/project.js';

const person = {name:'甲',gender:'男',era:'宋代',position:'主角',age_range:'成年',body_type:'高大',hairstyle:'束发',signature_props:[],immutable_traits:[],costumes:['常服','礼服'].map(name=>({name,color:'蓝',material:'布',props:[]}))};
const split = {剧集:[{序号:1,起始段落:'P001',结束段落:'P002',预估时长秒:30}],排除段落:[]};
const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; };
async function scenario(work) {
 const root=await mkdtemp(join(tmpdir(),'meiji-state-matrix-'));
 let repo=new ModelRepository(root), service;
 const project=projectFixture(); project.creation_mode='剧本'; project.script.body='宋代，甲穿蓝色常服入门。\n甲换上礼服离开。';
 project.character_library.characters=mergeCharacters(project,[person]).characters;
 let model=await repo.create(project), mode='ok', gate, entered, calls=0, failAt=Infinity;
 const execute=createHandlerRegistry({text:createTextHandler({chat:async ctx=>{
  if(ctx.step.kind==='review')return {是否通过:mode!=='reject',原因:mode==='reject'?'角色审核拒绝':''};
  await invoke(ctx);
  return ctx.task.business_type==='script-split' ? (mode==='reject'?{剧集:[],排除段落:[]} : split) : {characters:[person]};
 }}),media:async ctx=>{await invoke(ctx);return {content:{address:`${ctx.task.id}.png`}};}});
 async function invoke({signal}) {
  calls++;
  if(mode==='fail'||calls===failAt)throw Error('模拟模型失败');
  if(gate) { entered.resolve(); if(mode==='abort') await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})); else await gate.promise; }
 }
 const start=()=>service=new TaskService({repository:repo,execute,commitOutput:commitContent});start();
 const command=(kind,extra={})=>({type:kind==='costume-image'?'submit-costumes':'submit',project_id:project.id,request_id:crypto.randomUUID(),target_id:kind==='costume-image'?project.character_library.characters[0].id:project.id,...(kind==='costume-image'?{}:{business_type:kind}),action:kind==='costume-image'?'generate':'regenerate',...extra});
 const api={project,command,get model(){return model;},get service(){return service;},get calls(){return calls;},setMode(value){mode=value;},failOn(value){failAt=value;},block(value='late'){mode=value;gate=deferred();entered=deferred();return entered.promise;},release(){gate?.resolve();gate=null;},async reopen(){await repo.close();repo=new ModelRepository(root);model=await repo.open(project.id);start();await service.recover(model);}};
 try {await work(api);} finally {api.release();await service.dispose();await repo.close();await rm(root,{recursive:true,force:true});}
}

for(const kind of ['script-split','project-characters','costume-image']) {
 test(`${kind} 失败后继续，旧终态不变且无额外派生`,()=>scenario(async x=>{
  x.setMode('fail');await x.service.command(x.command(kind));await x.service.idle(x.project.id);
  const before=x.model.read();assert.equal(before.tasks[0].task_status,'failed');
  x.setMode('ok');const next=await x.service.command({type:'continue-group',project_id:x.project.id,request_id:'continue',group_id:before.groups[0].id});await x.service.idle(x.project.id);
  const after=x.model.read();assert.deepEqual(after.tasks.slice(0,before.tasks.length),before.tasks);
  const current=after.tasks.filter(t=>t.group_id===next.group_id);assert.ok(current.every(t=>t.task_status==='completed'),current.map(t=>t.end_reason).join(','));assert.equal(current.length,kind==='costume-image'?2:1);
  if(kind==='script-split')assert.equal(after.project.episodes.map(e=>e.plot).join(''),x.project.script.body);
 }));
 test(`${kind} 取消运行任务，晚到结果不覆盖，继续可执行`,()=>scenario(async x=>{
  const entered=x.block();await x.service.command(x.command(kind));await entered;
  const current=x.model.read(),task=current.tasks.find(t=>t.task_status==='running');
  await x.service.command({type:'cancel',project_id:x.project.id,request_id:'cancel',task_id:task.id});
  const cancelled=x.model.read();assert.equal(cancelled.tasks[0].task_status,'cancelled');x.release();await x.service.idle(x.project.id);
  assert.deepEqual(x.model.read().tasks,cancelled.tasks);assert.deepEqual(x.model.read().project,cancelled.project);
  x.setMode('ok');const next=await x.service.command({type:'continue-group',project_id:x.project.id,request_id:'resume',group_id:task.group_id});await x.service.idle(x.project.id);
  assert.ok(x.model.read().tasks.filter(t=>t.group_id===next.group_id).every(t=>t.task_status==='completed'));
 }));
 for(const shutdown of ['late','abort']) test(`${kind} 运行中重启（${shutdown}），作废旧组且恢复后不重放`,()=>scenario(async x=>{
  const entered=x.block(shutdown);await x.service.command(x.command(kind));await entered;
  const beforeStop=x.model.read().tasks.map(t=>({id:t.id,task_status:t.task_status}));
  const stop=x.service.dispose();if(shutdown==='late'){await new Promise(r=>setTimeout(r,10));x.release();}await stop;
  const old=x.model.read();
  for (const item of beforeStop) {
    const task=old.tasks.find(t=>t.id===item.id);
    const expected=['queued','running'].includes(item.task_status)?'cancelled':item.task_status;
    assert.equal(task.task_status, expected, `${item.id}:${task.end_reason}`);
  }

  const calls=x.calls;x.release();x.setMode('ok');await x.reopen();assert.equal(x.calls,calls);assert.deepEqual(x.model.read().tasks,old.tasks);
  const next=await x.service.command({type:'continue-group',project_id:x.project.id,request_id:'restart-resume',group_id:old.groups[0].id});await x.service.idle(x.project.id);
  assert.ok(x.model.read().tasks.filter(t=>t.group_id===next.group_id).every(t=>t.task_status==='completed'));
 }));
 test(`${kind} 尚未调度时重启，恢复原节点并允许新提交`,()=>scenario(async x=>{
  const before=x.model.read().project;
  await seedQueuedTasks(x.model, [[kind,kind==='costume-image'?x.project.character_library.characters[0].costumes[0].id:x.project.id]]);
  assert.ok(x.model.read().tasks.every(t=>t.task_status==='queued'));assert.equal(x.calls,0);
  await x.service.dispose();await x.reopen();assert.ok(x.model.read().tasks.every(t=>t.task_status==='cancelled'&&t.end_reason==='服务重启，未完成任务已取消'));assert.deepEqual(x.model.read().project,before);
  await x.service.command(x.command(kind));await x.service.idle(x.project.id);assert.equal(x.model.read().tasks.at(-1).task_status,'completed');
 }));
}
for(const kind of ['script-split','project-characters']) test(`${kind} 审核不通过耗尽修订，继续保留原因`,()=>scenario(async x=>{
 x.setMode('reject');await x.service.command(x.command(kind));await x.service.idle(x.project.id);const old=x.model.read();assert.equal(old.tasks[0].task_status,'rejected');
 x.setMode('ok');const result=await x.service.command({type:'continue-group',project_id:x.project.id,request_id:'resume-rejected',group_id:old.groups[0].id});await x.service.idle(x.project.id);
 const next=x.model.read().tasks.find(t=>t.group_id===result.group_id);assert.equal(next.task_status,'completed',next.end_reason);assert.ok(next.opinion);
}));

for(const kind of ['script-split','project-characters','costume-image']) test(`${kind} SIGKILL 后新进程连接恢复真实落盘状态`,async()=>{
 const {fork}=await import('node:child_process');const {once}=await import('node:events');
 const root=await mkdtemp(join(tmpdir(),'meiji-kill-state-'));let repo=new ModelRepository(root),child,service;
 try {
  const project=projectFixture();project.creation_mode='剧本';project.character_library.characters=mergeCharacters(project,[person]).characters;
  await repo.create(project);await repo.close();
  child=fork(new URL('./fixtures/workflow-crash.js',import.meta.url),[root,project.id,kind],{stdio:['ignore','ignore','ignore','ipc']});
  const [message]=await once(child,'message',{signal:AbortSignal.timeout(10000)});assert.equal(message.event,'running');
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  repo=new ModelRepository(root);const model=await repo.open(project.id),before=model.read();assert.equal(before.tasks[0].task_status,'running');
  service=new TaskService({repository:repo,execute:async()=>{assert.fail('旧任务不能重放');},commitOutput:commitContent});await service.recover(model);
  const after=model.read();
  for (const item of before.tasks) {
    const task=after.tasks.find(t=>t.id===item.id);
    const expected=['queued','running'].includes(item.task_status)?'cancelled':item.task_status;
    assert.equal(task.task_status, expected, task.end_reason);
  }
  assert.ok(after.steps.every(st=>['done','cancelled'].includes(st.step_status)));
  assert.deepEqual(after.project.episodes,before.project.episodes);
  if(kind==='costume-image'){const c=after.project.character_library.characters[0];assert.equal(primaryCostumeImage(c).node_state.status,'cancelled');assert.equal(c.costume_images[1].node_state.status,'empty');}
  const stable=model.read();await service.recover(model);assert.deepEqual(model.read(),stable);
 }finally{child?.kill('SIGKILL');await service?.dispose();await repo.close();await rm(root,{recursive:true,force:true});}
});


test('首套成功后次套失败，重启后继续只做未完成服装',()=>scenario(async x=>{
 x.failOn(2);await x.service.command(x.command('costume-image'));await x.service.idle(x.project.id);
 const before=x.model.read(),saved=before.project.character_library.characters[0].costume_images[0];
 assert.deepEqual(before.tasks.map(t=>t.task_status),['completed','failed']);
 await x.service.dispose();await x.reopen();
 const next=await x.service.command({type:'continue-group',project_id:x.project.id,request_id:'resume-second',group_id:before.groups[0].id});await x.service.idle(x.project.id);
 assert.equal(next.task_ids.length,1);assert.equal(x.model.read().tasks.at(-1).task_status,'completed');assert.deepEqual(x.model.read().project.character_library.characters[0].costume_images[0],saved);
}));

test('定妆照全量完成后补齐不重复请求，首套过期则连同后续一起重做',()=>scenario(async x=>{
 await x.service.command(x.command('costume-image'));await x.service.idle(x.project.id);assert.equal(x.calls,2);
 const skip=await x.service.command(x.command('costume-image'));assert.deepEqual(skip.task_ids,[]);assert.equal(x.calls,2);
 await x.model.update('expire-first',{},s=>{const first=primaryCostumeImage(s.project.character_library.characters[0]);first.node_state.status='expired';first.node_state.reason='用户资料变化';});
 const next=await x.service.command(x.command('costume-image'));assert.equal(next.task_ids.length,2);await x.service.idle(x.project.id);assert.equal(x.calls,4);
}));

for(const kind of ['script-split','project-characters','costume-image']) test(`${kind} 前置资料空缺失败，不调用模型`,()=>scenario(async x=>{
 await x.model.update('empty-input',{},s=>{if(kind==='costume-image'){const c=s.project.character_library.characters[0];for(const key of ['name','gender','era','position','age_range','body_type','hairstyle'])c[key]='';}else s.project.script.body='';});
 await x.service.command(x.command(kind));await x.service.idle(x.project.id);assert.equal(x.calls,0);assert.equal(x.model.read().tasks[0].task_status,'failed');assert.equal(x.model.read().steps[0].kind,'precheck');assert.equal(x.model.read().steps[0].step_status,'failed');
}));
