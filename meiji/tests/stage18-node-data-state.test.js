import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { projectFixture, snapshotFixture } from './fixtures/project.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { TaskService } from '../server/flow/tasks/task-manager.js';
import { renderTaskPanel } from '../client/task-panel.js';
import { latestNodeTask } from '../client/node-task-status.js';
import { migrateNodeDataStates } from '../server/data/node-data-state-migration.js';

for (const outcome of ['failed','cancelled']) test(`任务${outcome}保留原未通过数据与原因，SQLite及项目JSON一致`, async () => {
  const root=await mkdtemp(join(tmpdir(),'node-data-state-'));
  const repo=new ModelRepository(root);
  let service, release;
  try {
    const p=projectFixture(), e=p.episodes[0];
    Object.assign(e.summary.node_state,{status:'rejected',reason:'人物动机不足'});
    const model=await repo.create(p), before=structuredClone(model.readAll().project.episodes[0].summary);
    let started;
    const ready=new Promise(resolve=>{started=resolve;});
    const wait=new Promise(resolve=>{release=resolve;});
    service=new TaskService({repository:repo,execute:async()=>{started();await wait;throw new Error('连接已断开');}});
    const submitted=await service.command({type:'submit',project_id:p.id,request_id:'retry',business_type:'episode-summary',target_id:e.id,action:'regenerate'});
    await ready;
    assert.deepEqual(model.readAll().project.episodes[0].summary,before,'运行中仍保留数据状态');
    if(outcome==='cancelled')await service.command({type:'cancel',project_id:p.id,request_id:'cancel',task_id:submitted.task_id});
    release();await service.idle(p.id);
    const saved=model.readAll();
    assert.equal(saved.tasks[0].task_status,outcome);
    if(outcome==='failed')assert.match(saved.tasks[0].end_reason,/连接已断开/);
    assert.deepEqual(saved.project.episodes[0].summary,before);
    const json=JSON.parse(await readFile(join(root,p.id,'project.json'),'utf8'));
    assert.deepEqual(json.episodes[0].summary,before);
    const reopened=new ModelRepository(root);
    try{assert.deepEqual((await reopened.open(p.id)).read().project.episodes[0].summary,before);}finally{await reopened.close();}
  }finally{release?.();await service?.dispose();await repo.close();await rm(root,{recursive:true,force:true});}
});

test('失败原因与审核原因在意见下分行展示；从未执行隐藏任务行',()=>{
  const dom=new JSDOM('<main></main>'),previous=globalThis.document;
  globalThis.document=dom.window.document;
  try{
    const s=snapshotFixture(),e=s.project.episodes[0],root=document.querySelector('main');
    Object.assign(e.summary.node_state,{status:'rejected',reason:'缺少动作'});
    const context={session_id:'test',view:{page:'episode',episode_id:e.id,tab:'script'},refresh:async()=>{},paint:()=>{},onError:()=>{}};
    const paint=()=>{renderTaskPanel(root,s,context);return root.querySelector('[data-business="episode-summary"]');};
    assert.equal(paint().querySelector('.node-ui-task-status'),null);
    s.tasks=[{id:'old',business_type:'episode-summary',target_id:e.id,task_status:'failed',end_reason:'网络超时',queue_order:1}];
    let card=paint(),ui=card.querySelector('.node-ui');
    assert.deepEqual([...ui.children].map(x=>x.className),['workflow-generation-row','node-ui-opinion','error node-ui-reason node-ui-failure','error node-ui-reason','node-ui-buttons node-ui-repair-row']);
    assert.equal(card.querySelector('.section-titles .node-data-tag').textContent,'未通过');
    assert.equal(ui.querySelector('.node-ui-status'),null);
    assert.deepEqual([...ui.querySelector('.workflow-generation-row').children].map(x=>x.className),['node-ui-buttons','node-ui-task-status']);
    assert.equal(ui.querySelector('.node-ui-task-status').textContent,'最新任务：失败');
    assert.equal(ui.children[2].textContent,'失败原因：网络超时');
    assert.equal(ui.children[3].textContent,'未通过原因：缺少动作');
    s.tasks.push({id:'current',business_type:'episode-summary',target_id:e.id,task_status:'queued',queue_order:2});
    assert.equal(paint().querySelector('.node-ui-task-status').textContent,'最新任务：排队中');
    assert.equal(latestNodeTask(s.tasks,'episode-summary',e.id).id,'current');
    s.tasks[1].task_status='completed';
    Object.assign(e.summary.node_state,{status:'generated',reason:''});
    card=paint();ui=card.querySelector('.node-ui');
    assert.equal(ui.querySelector('.node-ui-task-status').textContent,'最新任务：已完成');
    assert.equal(card.querySelector('.node-data-tag').textContent,'已生成');
    assert.equal(ui.querySelector('.node-ui-reason'),null);
  }finally{globalThis.document=previous;dom.window.close();}
});

test('旧执行状态显式迁移：恢复审核原因、有效数据、过期数据和空节点，不修改历史',()=>{
  for(const status of ['running','failed','cancelled']){
    const s=snapshotFixture(),e=s.project.episodes[0];
    Object.assign(e.summary.node_state,{status,reason:'',fail_message:'旧失败'});
    s.tasks=[{business_type:'episode-summary',target_id:e.id,task_status:status,queue_order:1,previous_node_state:{status:'rejected',reason:'原审核原因',fail_message:''}}];
    const old=structuredClone(s.tasks);
    migrateNodeDataStates(s);
    assert.equal(e.summary.node_state.status,'rejected');assert.equal(e.summary.node_state.reason,'原审核原因');assert.equal(e.summary.node_state.fail_message,'');
    assert.deepEqual(s.tasks,old);
  }
  const s=snapshotFixture(),e=s.project.episodes[0];
  e.summary.node_state.status='failed';
  e.story_outline.node_state.status='cancelled';e.story_outline.node_state.dependency_hash='';
  s.project.project_summary.body='';s.project.project_summary.node_state.status='running';
  migrateNodeDataStates(s);
  assert.equal(e.summary.node_state.status,'generated');assert.equal(e.story_outline.node_state.status,'expired');assert.equal(s.project.project_summary.node_state.status,'empty');
});

test('v14到v15事务迁移落盘且只执行一次',async()=>{
  const root=await mkdtemp(join(tmpdir(),'node-state-migration-'));
  let repo=new ModelRepository(root);
  try{
    const p=projectFixture(),model=await repo.create(p),before=model.readAll();await repo.close();
    const legacy=structuredClone(before.project);legacy.episodes[0].summary.node_state.status='failed';legacy.episodes[0].summary.node_state.fail_message='旧连接失败';
    const db=new DatabaseSync(join(root,'meiji.sqlite'));
    db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(legacy),p.id);
    db.exec('DELETE FROM schema_migrations WHERE version>=15; PRAGMA user_version=14');db.close();
    repo=new ModelRepository(root);
    const migrated=(await repo.open(p.id)).read();
    assert.equal(migrated.project.episodes[0].summary.node_state.status,'generated');
    assert.equal(migrated.project.episodes[0].summary.body,before.project.episodes[0].summary.body);
    assert.equal(migrated.runtime.revision,before.runtime.revision+2);
    await repo.close();repo=new ModelRepository(root);
    assert.deepEqual((await repo.open(p.id)).read(),migrated);
  }finally{await repo.close();await rm(root,{recursive:true,force:true});}
});
