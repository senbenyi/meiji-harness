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
const row={编号:'C01',名称:'武松',国籍:'',身份:'',身份特征:'',性别:'',年代:'',年龄:'',身高:'',体型:'',面相:'',声音:'',必出:true,默认服装编号:'C01-01',服装:[{编号:'C01-01',名称:'常服',描述:'白衣'}]};

test('独立任务持久化单组及三级名称，重命名项目不改历史名称',()=>fixture(async({p,repository,model,root})=>{
 const service=new TaskService({repository,commitOutput:commitContent,execute:async({step})=>step.kind==='review'?{result:{通过:true,原因:''}}:{content:{正文:'摘要'}}});
 const result=await service.command({type:'submit',project_id:p.id,request_id:'one',business_type:'project-summary',target_id:p.id,action:'regenerate'});
 await service.idle(p.id);const before=model.read();assert.equal(before.groups.length,1);assert.equal(before.groups[0].group_type,'single');
 assert.equal(before.tasks[0].task_status,'completed');assert.ok(before.groups[0].name);assert.ok(before.tasks[0].name);assert.ok(before.steps.every(s=>s.name));
 await model.update('rename',{rename:true},s=>{s.project.名称='新项目名';return {};});
 assert.deepEqual(model.read().tasks,before.tasks);
 const restored=await new ModelRepository(root).open(p.id);assert.deepEqual(restored.read().groups,before.groups);
 assert.equal(groupDetail(restored,before.tasks[0].group_id).steps.length,3);
 assert.equal(result.task_id,before.tasks[0].id);
}));

test('提取派生角色服装同组，子任务失败不改父终态，继续新组保留历史',()=>fixture(async({p,repository,model})=>{
 let fail=true;
 const service=new TaskService({repository,commitOutput:commitContent,execute:async({snapshot,task,step})=>{
  if(step.kind==='review')return{result:{通过:true,原因:''}};
  if(task.business_type==='project-characters')return{content:prepareContent(snapshot,task,{角色:[row]})};
  if(fail)throw new Error('图片失败');
  return{content:{地址:'image.png'}};
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
