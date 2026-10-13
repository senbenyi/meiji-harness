import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelRepository} from '../server/data/model-repository.js';
import {TaskService} from '../server/flow/tasks/task-service.js';
import {commitContent,prepareContent} from '../server/handlers/content.js';
import {projectFixture} from './fixtures/project.js';
import {groupDetail} from '../server/data/task-store.js';

async function fixture(work) {
 const root=await mkdtemp(join(tmpdir(),'meiji-history-groups-'));
 try {const p=projectFixture(), repository=new ModelRepository(root), model=await repository.create(p);await work({p,repository,model,root});}
 finally {await rm(root,{recursive:true,force:true});}
}
const row={name:'武松',position:'主角',age_range:'青年',body_type:'强壮',hairstyle:'束发',signature_props:'',immutable_traits:'',costumes:[{name:'常服',color:'白',material:'布',props:''}]};

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

test('提取派生角色服装同组，子任务失败不改父终态，继续新组保留历史',()=>fixture(async({p,repository,model})=>{
 let fail=true;
 const service=new TaskService({repository,commitOutput:commitContent,execute:async({snapshot,task,step})=>{
  if(step.kind==='review')return{result:{是否通过:true,原因:''}};
  if(task.business_type==='project-characters')return{content:prepareContent(snapshot,task,{characters:[row]})};
  if(fail)throw new Error('图片失败');
  return{content:{address:'image.png'}};
 }});
 await service.command({type:'submit',project_id:p.id,request_id:'extract',business_type:'project-characters',target_id:p.id,action:'generate'});
 await service.idle(p.id);const before=model.read();
 assert.equal(before.groups.length,1);assert.equal(before.groups[0].name,'提取剧本重要角色及图片');
 assert.deepEqual(before.tasks.map(t=>t.group_seq),[1,2,3]);assert.ok(before.tasks.every(t=>t.group_id===before.groups[0].id));
 assert.deepEqual(before.tasks.map(t=>t.task_status),['completed','failed','superseded']);
 assert.equal(groupDetail(model,before.groups[0].id).status,'failed');
 fail=false;const result=await service.command({type:'continue-group',project_id:p.id,request_id:'again',group_id:before.groups[0].id});
 assert.notEqual(result.group_id,before.groups[0].id);assert.equal(result.task_ids.length,2);
 await service.command({type:'start-queued',project_id:p.id,request_id:'start',task_id:result.task_ids[0]});await service.idle(p.id);
 assert.deepEqual(model.read().tasks.slice(0,3),before.tasks);assert.deepEqual(model.read().groups[0],before.groups[0]);
 assert.equal(groupDetail(model,result.group_id).status,'completed');
}));

test('派生目标被其他任务占用时整次写回回滚，不借用旧任务或留下半组',()=>fixture(async({p,repository,model})=>{
 const {emptyCharacterModel}=await import('../shared/models/character_model.js');
 const character=emptyCharacterModel({number:'C01',name:'武松',body_type:'强壮',position:'原资料'});
 await model.update('existing-role',{},s=>{s.project.character_library.characters=[character];s.project.character_library.node_state.status='generated';});
 let enter,release;
 const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const service=new TaskService({repository,commitOutput:commitContent,execute:async({snapshot,task,step})=>{
  if(step.kind==='review')return{result:{是否通过:true,原因:''}};
  if(task.business_type==='project-characters'){
   const content=prepareContent(snapshot,task,{characters:[{...row,costumes:[],position:'候选新资料'}]});
   enter();await gate;return{content};
  }
  throw new Error('外部排队任务不应自动执行');
 }});
 try{
  const extraction=await service.command({type:'submit',project_id:p.id,request_id:'extract-conflict',business_type:'project-characters',target_id:p.id,action:'regenerate'});
  await entered;
  const separate=await service.command({type:'submit',project_id:p.id,request_id:'separate-image',business_type:'character-image',target_id:character.id,action:'generate'});
  release();await service.idle(p.id);
  const snapshot=model.read(),task=snapshot.tasks.find(t=>t.id===extraction.task_id);
  assert.equal(task.task_status,'failed');assert.match(task.end_reason,/已有未结束任务/);
  assert.equal(snapshot.project.character_library.characters[0].position,'原资料');
  assert.equal(snapshot.tasks.find(t=>t.id===separate.task_id).task_status,'queued');
  assert.equal(snapshot.tasks.length,2);
  assert.equal(snapshot.tasks.filter(t=>t.group_id===task.group_id).length,1);
 }finally{release();await service.dispose();}
}));
