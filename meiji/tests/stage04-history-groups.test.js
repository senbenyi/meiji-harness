import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelRepository} from '../server/data/model-repository.js';
import {TaskService} from '../server/flow/tasks/task-manager.js';
import {commitContent,prepareContent} from '../server/handlers/content.js';
import {projectFixture} from './fixtures/project.js';
import {groupDetail} from '../server/data/task-store.js';

async function fixture(work) {
 const root=await mkdtemp(join(tmpdir(),'meiji-history-groups-'));
 try {const p=projectFixture(), repository=new ModelRepository(root), model=await repository.create(p);await work({p,repository,model,root});}
 finally {await rm(root,{recursive:true,force:true});}
}
const row={name:'武松',gender:'男',era:'宋代',position:'主角',age_range:'青年',body_type:'强壮',hairstyle:'束发',signature_props: [],immutable_traits: [],costumes:[{name:'常服',color:'白',material:'布',props: []}]};

test('角色提取继续可排队，项目取消后再次继续保留原因和历史',()=>fixture(async({p,repository,model})=>{
 let reject=true;const opinions=[]; let release,enter; const gate=new Promise(r=>release=r),entered=new Promise(r=>enter=r);
 const service=new TaskService({repository,commitOutput:commitContent,execute:async({snapshot,task,step})=>{
  if(task.business_type==='project-summary'){enter();await gate;return {content:{body:'摘要'}};}
  if(step.kind==='review')return{result:{是否通过:!reject,原因:reject?'遗漏角色':''}};
  if(task.business_type==='project-characters'){opinions.push(task.opinion);return{content:prepareContent(snapshot,task,{characters:[row]})};}
  return{content:{address:'image.png'}};
 }});
 try {
  await service.command({type:'submit',project_id:p.id,request_id:'extract-rejected',business_type:'project-characters',target_id:p.id,action:'generate'});
  await service.idle(p.id);const before=model.read(),original=before.groups[0];
  assert.equal(before.tasks[0].task_status,'rejected');
  const waiting=await service.command({type:'submit',project_id:p.id,request_id:'other',business_type:'project-summary',target_id:p.id,action:'regenerate'},{source:'session',session_id:'s'});
  await entered;
  const pending=await service.command({type:'continue-group',project_id:p.id,request_id:'waiting-resume',group_id:original.id});
  assert.ok(model.read().tasks.filter(t=>t.group_id===pending.group_id).every(t=>t.task_status==='queued'));
  assert.equal(model.read().groups.length,3);
  await service.command({type:'cancel',project_id:p.id,request_id:'remove',task_id:waiting.task_id});
  release(); await service.idle(p.id);
  reject=false;
  const next=await service.command({type:'continue-group',project_id:p.id,request_id:'resume',group_id:original.id});
  await service.idle(p.id);
  assert.equal(groupDetail(model,next.group_id).status,'completed');
  assert.equal(opinions.at(-1),'遗漏角色');
  assert.deepEqual(model.read().tasks[0],before.tasks[0]);
 } finally {release();await service.dispose();}
}));

test('独立任务持久化单组及三级名称，重命名项目不改历史名称',()=>fixture(async({p,repository,model,root})=>{
 const service=new TaskService({repository,commitOutput:commitContent,execute:async({step})=>step.kind==='review'?{result:{是否通过:true,原因:''}}:{content:{body:'摘要'}}});
 const result=await service.command({type:'submit',project_id:p.id,request_id:'one',business_type:'project-summary',target_id:p.id,action:'regenerate'});
 await service.idle(p.id);const before=model.read();assert.equal(before.groups.length,1);assert.equal(before.groups[0].group_type,'single');
 assert.equal(before.tasks[0].task_status,'completed');assert.ok(before.groups[0].name);assert.ok(before.tasks[0].name);assert.ok(before.steps.every(s=>s.name));
 await model.update('rename',{rename:true},s=>{s.project.name='新项目名';return {};});
 assert.deepEqual(model.read().tasks,before.tasks);
 const restored=await new ModelRepository(root).open(p.id);assert.deepEqual(restored.read().groups,before.groups);
 assert.equal(groupDetail(restored,before.tasks[0].group_id).steps.length,3);
 assert.equal(result.task_id,before.tasks[0].id);
}));

test('提取不派生图片，逐套定妆照中途失败后继续新组并保留历史',()=>fixture(async({p,repository,model})=>{
 let fail=true;
 const service=new TaskService({repository,commitOutput:commitContent,execute:async({snapshot,task,step})=>{
  if(step.kind==='review')return{result:{是否通过:true,原因:''}};
  if(task.business_type==='project-characters')return{content:prepareContent(snapshot,task,{characters:[{...row,costumes:[...row.costumes,{...row.costumes[0],name:'礼服'}]}]})};
  if(fail)throw new Error('图片失败');
  return{content:{address:'image.png'}};
 }});
 try {
  await service.command({type:'submit',project_id:p.id,request_id:'extract',business_type:'project-characters',target_id:p.id,action:'generate'});
  await service.idle(p.id);
  assert.equal(model.read().tasks.length,1);
  const character=model.read().project.character_library.characters[0];
  const request={type:'submit-costumes',project_id:p.id,request_id:'pictures',target_id:character.id,action:'generate'};
  const pictures=await service.command(request);
  assert.deepEqual(await service.command(request),pictures);
  await service.idle(p.id);const before=model.read();
  assert.equal(before.groups.length,2);
  assert.deepEqual(before.tasks.map(t=>t.task_status),['completed','failed','cancelled']);
  assert.equal(groupDetail(model,pictures.group_id).status,'failed');
  fail=false;const result=await service.command({type:'continue-group',project_id:p.id,request_id:'again',group_id:pictures.group_id});
  assert.notEqual(result.group_id,pictures.group_id);assert.equal(result.task_ids.length,2);
  await service.idle(p.id);
  assert.deepEqual(model.read().tasks.slice(0,3),before.tasks);
  assert.equal(groupDetail(model,result.group_id).status,'completed');
  assert.ok(model.read().project.character_library.characters[0].costume_images.every(image=>image.address));
 }finally{await service.dispose();}
}));

test('逐套组与已有定妆照任务冲突时整组拒绝，旧角色图命令拒绝',()=>fixture(async({p,repository,model})=>{
 const {emptyCharacterModel}=await import('../shared/models/character_model.js');
 const character=emptyCharacterModel({number:'C01',name:'武松'});
 await model.update('role',{},s=>{s.project.character_library.characters=[character];});
 const service=new TaskService({repository,commitOutput:commitContent,execute:async()=>{throw Error('不应执行');}});
 try{
  const cmd={type:'submit',project_id:p.id,request_id:'one',business_type:'costume-image',target_id:character.id,action:'generate'};
  await service.command(cmd,{source:'session',session_id:'s'});
  await assert.rejects(service.command({type:'submit-costumes',project_id:p.id,request_id:'group',target_id:character.id,action:'generate'}),/未结束任务/);
  await assert.rejects(service.command({...cmd,business_type:'character-image',request_id:'retired'}),/独立角色图已移除/);
  assert.equal(model.read().tasks.length,1);
 }finally{await service.dispose();}
}));
