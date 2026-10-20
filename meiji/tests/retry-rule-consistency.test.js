import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createAppRuntime} from '../server/runtime/app-runtime.js';
import {SQLiteStore} from '../server/data/sqlite-store.js';
import {projectFixture,snapshotFixture,taskFixture} from './fixtures/project.js';
import {taskNodeInput} from '../server/handlers/node-inputs.js';
import {resumeState} from '../server/flow/tasks/resume-state.js';
import {composeNodePrompt,nodeRoutes} from '../server/http/ai-routes.js';
import {sampleInput} from './fixtures/ai.js';
import {newStep} from '../shared/task-plan.js';
import {validateStep} from '../shared/task_contract.js';
import {NODE_DEFINITIONS} from '../shared/node-definitions.js';

for(const finish of [true,false])test(`第三轮修订${finish?'通过':'耗尽'}：实际任务、SQLite和逐轮messages共用3次预算`,async()=>{
 const home=await mkdtemp(join(tmpdir(),'meiji-three-revisions-'));let runtime;
 try{
  const p=projectFixture(),calls=[];
  runtime=await createAppRuntime({home,gateway:{chat:async options=>{
   calls.push(options);const {step}=options;
   if(step.kind==='review'){const pass=finish&&step.round===3;return{是否通过:pass,类型:pass?'':'模型问题',原因:pass?'':`本轮问题-${step.round}`};}
   return`完整候选-${step.round}`;
  }}});
  const model=await runtime.repository.create(p);
  const result=await runtime.tasks.command({type:'submit',project_id:p.basic_info.id,target_id:p.basic_info.id,business_type:'project-summary',action:'regenerate',opinion:'本次要求哨兵',request_id:crypto.randomUUID()});
  await runtime.tasks.idle(p.basic_info.id);
  const snapshot=model.readAll(),task=snapshot.tasks.find(t=>t.id===result.task_id);
  assert.equal(task.task_status,finish?'completed':'rejected',task.end_reason);
  assert.equal(snapshot.project.project_summary.body,'完整候选-3');
  assert.deepEqual(snapshot.steps.filter(s=>s.kind==='revise').map(s=>s.round),[1,2,3]);
  assert.deepEqual(snapshot.steps.filter(s=>s.kind==='review').map(s=>s.round),[0,1,2,3]);
  for(const call of calls.filter(c=>c.step.kind==='revise')){
   const round=call.step.round,assistant=call.messages.filter(m=>m.role==='assistant');
   assert.equal(assistant.length,1);assert.equal(assistant[0].content,`完整候选-${round-1}`);
   assert.ok(call.messages.at(-1).content.includes(`本轮问题-${round-1}`));
   assert.ok(call.messages.at(-1).content.includes('本次要求哨兵'));
   assert.equal(call.trace.input.content,`完整候选-${round-1}`);
   if(round>1)assert.ok(!call.trace.input.opinion.includes(`本轮问题-${round-2}`));
  }
  const stored=runtime.repository.history(p.basic_info.id).stepsOf(task.id,{records:true});
  assert.equal(stored.filter(s=>s.round===3&&s.kind==='revise')[0].prompt.messages.filter(m=>m.role==='assistant').length,1);
 }finally{await runtime?.dispose();await rm(home,{recursive:true,force:true});}
});

test('文本统一3次预算，步骤3合法、步骤4拒绝，非文本仍无自动内容修订',()=>{
 for(const d of Object.values(NODE_DEFINITIONS))if(!d.retired)assert.equal(d.retryRounds,d.handler==='text'?3:0);
 const p=projectFixture(),task=taskFixture(p,'project-summary',p.basic_info.id),step=newStep(task,1,'revise',3);
 assert.doesNotThrow(()=>validateStep(step,task));assert.throws(()=>validateStep({...step,round:4},task),/step.round/);
});

test('第三轮镜头修订继承最新完整候选，不把坏patch或过时诊断当基稿',()=>{
 const snapshot=snapshotFixture(),p=snapshot.project,task=taskFixture(p,'shots',p.episodes[0].id,{action:'revise',opinion:'本次意见'});
 const original={shots:structuredClone(p.episodes[0].shot_list.shots)};original.shots[0].body='初始候选-0';
 const updated=structuredClone(original);updated.shots[0].body='最新完整候选-2';
 const step=(seq,kind,round,result,reviewer,prompt)=>({...newStep(task,seq,kind,round,reviewer),step_status:kind==='review'?'rejected':'done',result,prompt});
 snapshot.steps=[step(2,'generate',0,original),step(4,'review',0,{是否通过:false,类型:'模型问题',原因:'旧业务意见-0'},'ai'),
  step(5,'revise',1,{mode:'patch',shots:[{id:'wrong',changes:{body:'坏patch片段-1'}}]},null,{input:{content:original}}),
  step(6,'review',1,{是否通过:false,类型:'模型问题',原因:'旧程序意见-1'},'program'),step(8,'revise',2,updated),
  step(10,'review',2,{是否通过:false,类型:'模型问题',原因:'最新业务意见-2'},'ai')];
 const input=taskNodeInput(snapshot,task,null,'regenerate',newStep(task,11,'revise',3));
 assert.deepEqual(input.content,updated);assert.ok(input.opinion.includes('最新业务意见-2'));
 assert.ok(!input.opinion.includes('旧业务意见-0'));assert.ok(!input.opinion.includes('旧程序意见-1'));
 const prompt=composeNodePrompt('shots','regenerate',input,'codex-gpt'),assistant=prompt.messages.filter(m=>m.role==='assistant');
 assert.equal(assistant.length,1);assert.deepEqual(JSON.parse(assistant[0].content),updated);
 assert.ok(!JSON.stringify(prompt.messages).includes('坏patch片段-1'));
});

for (const crossTask of [false,true]) test(`无mode片段被拒后${crossTask?'跨任务':'自动下一轮'}修订仍使用最近完整基稿`,()=>{
 const snapshot=snapshotFixture(),p=snapshot.project,episode=p.episodes[0];
 const old=taskFixture(p,'shots',episode.id,{action:'revise',task_status:'rejected',queue_order:1});
 const full={shots:structuredClone(episode.shot_list.shots)};
 full.shots.push({...structuredClone(full.shots[0]),id:'',title:'完整候选的新增镜头',body:'必须保留的另一镜'});
 const fragment={shots:[structuredClone(full.shots[0])]};
 const done={...newStep(old,8,'revise',2),step_status:'done',result:fragment,prompt:{action:'regenerate',input:{content:full}}};
 const rejected={...newStep(old,9,'review',2,'program'),step_status:'rejected',result:{是否通过:false,类型:'模型问题',原因:'未声明replace的片段'}};
 const task=crossTask?{...old,id:'t_next',task_status:'running',queue_order:2}:old;
 snapshot.tasks=[old,task];snapshot.steps=[done,rejected];episode.shot_list.node_state.status='rejected';
 const before=structuredClone(done);
 const input=taskNodeInput(snapshot,task,null,'regenerate',newStep(task,crossTask?2:11,crossTask?'generate':'revise',crossTask?0:3));
 assert.deepEqual(input.content,full);assert.deepEqual(done,before,'原失败片段和历史提示词不变');
 const messages=composeNodePrompt('shots','regenerate',input,'codex-gpt').messages;
 assert.deepEqual(JSON.parse(messages.find(m=>m.role==='assistant').content),full);
});

test('合法replace已通过程序审核后，归一全表仍作为下一轮基稿',()=>{
 const snapshot=snapshotFixture(),p=snapshot.project,task=taskFixture(p,'shots',p.episodes[0].id,{action:'revise'});
 const original={shots:structuredClone(p.episodes[0].shot_list.shots)},full=structuredClone(original);
 full.shots.push({...structuredClone(full.shots[0]),id:'',title:'合法新增镜头'});
 snapshot.steps=[{...newStep(task,5,'revise',1),step_status:'done',result:full,prompt:{action:'regenerate',input:{content:original}}},
  {...newStep(task,6,'review',1,'program'),step_status:'done',result:{是否通过:true,类型:'',原因:''}},
  {...newStep(task,7,'review',1,'ai'),step_status:'rejected',result:{是否通过:false,类型:'模型问题',原因:'仅需修饰正文'}}];
 assert.deepEqual(taskNodeInput(snapshot,task,null,'regenerate',newStep(task,8,'revise',2)).content,full);
});

test('未完成程序审核的归一全表候选不被误回退到旧表',()=>{
 const snapshot=snapshotFixture(),p=snapshot.project,task=taskFixture(p,'shots',p.episodes[0].id,{action:'revise'});
 const original={shots:structuredClone(p.episodes[0].shot_list.shots)},full=structuredClone(original);
 full.shots.push({...structuredClone(full.shots[0]),id:'',title:'全表替换新增镜头'});
 snapshot.steps=[{...newStep(task,5,'revise',1),step_status:'done',result:full,prompt:{action:'regenerate',input:{content:original}}},
  {...newStep(task,6,'review',1,'program'),step_status:'ready'}];
 assert.deepEqual(taskNodeInput(snapshot,task,null,'regenerate',newStep(task,8,'revise',2)).content,full);
});

for(const proof of ['http','http-rejected','program','fragment','stale-http'])test(`镜头表恢复保留全表替换意图：${proof}`,()=>{
 const snapshot=snapshotFixture(),p=snapshot.project,task=taskFixture(p,'shots',p.episodes[0].id,{action:'revise',opinion:'恢复校验'});snapshot.tasks=[task];
 const original=taskNodeInput(snapshot,task,null,'regenerate',newStep(task,2,'generate',0)).content;
 const full=structuredClone(original);full.shots.push({...structuredClone(full.shots[0]),id:'',title:'恢复后仍须保留的新增镜头',duration_seconds:4});
 const gen={...newStep(task,2,'generate',0),step_status:'done',result:original,prompt:{action:'regenerate',input:{content:original}}};
 const replace={...newStep(task,5,'revise',1),step_status:'done',result:full,prompt:{action:'regenerate',input:{content:original}},http:proof.startsWith('http')||proof==='stale-http'?[{ok:true,body:{choices:[{message:{content:JSON.stringify({mode:'replace',shots:full.shots})}}]}}]:[]};
 snapshot.steps=[gen,{...newStep(task,3,'review',0,'program'),step_status:'done'},
  {...newStep(task,4,'review',0,'ai'),step_status:'rejected',result:{是否通过:false,类型:'模型问题',原因:'需要新增镜头'}},replace,
  {...newStep(task,6,'review',1,'program'),step_status:proof==='http'||proof==='stale-http'?'ready':proof==='http-rejected'?'rejected':'done'}];
 if(proof==='stale-http')replace.http.push({ok:true,body:{choices:[{message:{content:JSON.stringify(full)}}]}});
 if(proof==='fragment')snapshot.steps.push({...newStep(task,8,'revise',2),step_status:'done',result:original,prompt:{action:'regenerate',input:{content:full}},http:[{ok:true,body:{choices:[{message:{content:JSON.stringify(original)}}]}}]},
  {...newStep(task,9,'review',2,'program'),step_status:'rejected',result:{是否通过:false,类型:'模型问题',原因:'增删须声明replace'}});
 const before=structuredClone(snapshot.steps),state=resumeState(snapshot,task);
 if(proof==='fragment'||proof==='stale-http'){assert.equal(state.draft,null);assert.match(state.validationFailure,/增删、拆并或重排/);}
 else{assert.equal(state.validationFailure,'');assert.equal(state.draft.shots.length,full.shots.length);assert.equal(state.draft.shots.at(-1).title,'恢复后仍须保留的新增镜头');}
 if(proof==='http-rejected')assert.deepEqual(taskNodeInput(snapshot,task,null,'regenerate',newStep(task,8,'revise',2)).content,full,'程序拒绝后仍修复有原始替换声明的完整候选');
 assert.deepEqual(snapshot.steps,before,'恢复读取不改写历史');
});

test('最终人物三动作请求共享可空与配件语义，审核保持三字段结果契约',()=>{
 for(const action of ['generate','regenerate','review']){
  const input=sampleInput(nodeRoutes['project-characters'].actions[action].input),prompt=composeNodePrompt('project-characters',action,input,'codex-gpt');
  assert.equal(prompt.system.split('nationality 没有国别时留空字符串').length,2);
  assert.equal(prompt.system.split('随造型出现的配件与道具放在 costumes[].props').length,2);
  if(action==='review'){assert.match(prompt.system,/只返回审核结果/);assert.doesNotMatch(prompt.system,/先补全缺项，再输出完整 JSON/);}
 }
});

for(const corrupt of [false,true])test(`v27→v28步骤约束迁移${corrupt?'遇外键错误完整回滚':'原样保留历史并允许第三轮'}`,async()=>{
 const home=await mkdtemp(join(tmpdir(),'meiji-round-migration-')),path=join(home,'meiji.sqlite');let db,store;
 try{
  db=new DatabaseSync(path);const schema=(await readFile(new URL('../server/data/schema.sql',import.meta.url),'utf8')).replace('CHECK(round BETWEEN 0 AND 3)','CHECK(round BETWEEN 0 AND 2)').replace(/INSERT INTO schema_migrations VALUES \(28,[^\n]+\n/,'').replace('PRAGMA user_version=28','PRAGMA user_version=27');db.exec(schema);if(corrupt)db.exec('PRAGMA foreign_keys=OFF');
  const p=projectFixture(),now='2026-10-19T00:00:00.000Z';
  const insert=(table,row)=>db.prepare(`INSERT INTO ${table} (${Object.keys(row)}) VALUES (${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  insert('projects',{id:p.basic_info.id,data_json:JSON.stringify(p),revision:7});
  insert('task_groups',{id:'tg_legacy',project_id:p.basic_info.id,episode_id:null,name:'历史组',group_type:'single',action:'regenerate',source:'panel',shot_ids_json:'[]',created_at:now,position:0});
  insert('tasks',{id:'t_legacy',project_id:p.basic_info.id,group_id:'tg_legacy',group_seq:1,name:'历史任务',business_type:'project-summary',target_id:p.basic_info.id,episode_id:null,action:'regenerate',source:'panel',task_status:'completed',queue_order:1,opinion:'旧意见',previous_node_state_json:'null',end_reason:'',created_at:now,started_at:now,ended_at:now,position:0});
  insert('task_steps',{id:'st_legacy',project_id:p.basic_info.id,task_id:corrupt?'t_missing':'t_legacy',seq:1,name:'第二轮历史',kind:'revise',round:2,step_status:'done',executor:'ai',prompt_json:'{"messages":[{"role":"assistant","content":"原始\\n正文"}]}',http_json:'[{"body":"原样记录"}]',result_json:'"旧候选"',error_reason:'历史原因',started_at:now,ended_at:now,position:0});
  const before=db.prepare('SELECT * FROM task_steps').get(),projectBefore=db.prepare('SELECT * FROM projects').get();db.close();db=null;
  if(corrupt){assert.throws(()=>new SQLiteStore(path),/外键/);db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,27);assert.deepEqual(db.prepare('SELECT * FROM task_steps').get(),before);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='task_steps_v28'").get().n,0);}
  else{
   store=new SQLiteStore(path);db=new DatabaseSync(path);
   assert.equal(db.prepare('PRAGMA user_version').get().user_version,29);assert.deepEqual(db.prepare('SELECT * FROM task_steps').get(),before);assert.deepEqual(db.prepare('SELECT * FROM projects').get(),projectBefore);
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.ok(db.prepare("PRAGMA index_list('task_steps')").all().some(r=>r.name==='steps_project'));
   assert.doesNotThrow(()=>db.prepare('UPDATE task_steps SET round=3').run());assert.throws(()=>db.prepare('UPDATE task_steps SET round=4').run(),/CHECK/);
   store.close();store=null;store=new SQLiteStore(path);assert.equal(store.stepsOf(p.basic_info.id,'t_legacy',{records:true})[0].round,3);
  }
 }finally{store?.close();db?.close();await rm(home,{recursive:true,force:true});}
});

test('旧拒绝诊断与本次意见分开传递，后续轮次不重复执行原任务旧诊断',()=>{
 const snapshot=snapshotFixture(),p=snapshot.project,reason='已被证伪的旧诊断',text=reason+'\n本次要求保留正确内容';
 const task=taskFixture(p,'project-summary',p.basic_info.id,{action:'revise',opinion:text,previous_node_state:{status:'rejected',reason}});
 const initial=taskNodeInput(snapshot,task,null,'regenerate',newStep(task,2,'generate',0));
 assert.match(initial.opinion,/历史审核诊断/);assert.match(initial.opinion,/不是新的剧情事实或本次要求/);assert.match(initial.opinion,/本次执行意见/);
 const firstGenerate=taskNodeInput(snapshot,task,null,'generate',newStep(task,2,'generate',0));assert.match(firstGenerate.requirements,/历史审核诊断/);
 snapshot.steps=[{...newStep(task,8,'revise',2),step_status:'done',result:'最近完整候选'},
  {...newStep(task,10,'review',2,'ai'),step_status:'rejected',result:{是否通过:false,类型:'模型问题',原因:'最新诊断'}}];
 const third=taskNodeInput(snapshot,task,null,'regenerate',newStep(task,11,'revise',3));
 assert.equal(third.content,'最近完整候选');assert.match(third.opinion,/本轮审核诊断/);assert.match(third.opinion,/最新诊断/);assert.match(third.opinion,/本次要求保留正确内容/);
 assert.ok(!third.opinion.includes(reason));assert.equal(task.opinion,text,'持久化原始意见保持');
});
