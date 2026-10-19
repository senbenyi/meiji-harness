import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {JSDOM} from 'jsdom';
import {createAppRuntime} from '../server/runtime/app-runtime.js';
import {ModelRepository} from '../server/data/model-repository.js';
import {projectFixture,taskFixture} from './fixtures/project.js';
import {defaultRules} from '../shared/rule-defaults.js';
import {ruleNode} from '../shared/ai-node-rules.js';
import {dependencyHash,stampDependencyHash,isNodeCurrent} from '../shared/node-dependencies.js';
import {taskNodeInput} from '../server/handlers/node-inputs.js';
import {composeNodePrompt} from '../server/http/ai-routes.js';
import {renderTaskPanel} from '../client/task-panel.js';
import {resumeState} from '../server/flow/tasks/resume-state.js';
const opinion='将哥伦比亚炮改为哥伦比亚号探月器，按新用途调整结构与操作。';
const original='哥伦比亚炮竖直安放，炮弹从炮口装入。旅行者准备出发。';
const adapted='哥伦比亚号探月器停在发射场，旅行者沿舷梯进入舱门，检查探月航线。';
const passed={是否通过:true,类型:'',原因:''};
function fixture(){const p=projectFixture();p.script.body=original;for(const b of ['script-review','project-summary','project-characters'])stampDependencyHash({project:p},b,p.id);for(const e of p.episodes)stampDependencyHash({project:p},'outline',e.id);return p;}
async function run(gateway,fn){const home=await mkdtemp(join(tmpdir(),'meiji-script-adapt-'));let runtime;try{runtime=await createAppRuntime({home,gateway});const p=fixture(),model=await runtime.repository.create(p);const submit=async(action,opinion='')=>{const result=await runtime.tasks.command({type:'submit',project_id:p.id,business_type:'script-review',target_id:p.id,action,opinion,request_id:crypto.randomUUID()});await runtime.tasks.idle(p.id);const s=model.readAll();return{s,task:s.tasks.find(t=>t.id===result.task_id)};};await fn({p,model,runtime,submit});}finally{await runtime?.dispose();await rm(home,{recursive:true,force:true});}}

test('完整改编任务携带意见及来源，审核后保存全文、版本历史并使下游过期',async()=>{
 const calls=[];await run({chat:async options=>{calls.push(options);return options.step.kind==='review'?passed:adapted;}},async({p,submit})=>{
  const before=structuredClone(p),{s,task}=await submit('revise',opinion);
  assert.equal(task.task_status,'completed',task.end_reason);assert.equal(calls.length,2);
  assert.equal(calls[0].trace.input.content,original);assert.equal(calls[0].trace.input.opinion,opinion);
  assert.equal(calls[1].trace.input.content,adapted);assert.equal(calls[1].trace.input.script,original);assert.equal(calls[1].trace.input.opinion,opinion);
  assert.equal(s.project.script.body,adapted);assert.equal(s.project.script.version,before.script.version+1);
  assert.equal(s.project.script.revision_history.at(-1).task_id,task.id);assert.equal(s.project.script.revision_history.at(-1).revision_notes,opinion);
  assert.ok(s.project.script.updated_at);assert.equal(s.project.script.node_state.status,'generated');
  assert.equal(s.project.project_summary.node_state.status,'expired');assert.equal(s.project.character_library.node_state.status,'expired');
  assert.equal(s.project.episodes[0].story_outline.node_state.status,'expired');
  assert.equal(s.project.episodes[0].shot_list.shots[0].video.address,before.episodes[0].shot_list.shots[0].video.address);
  assert.equal(s.project.episodes[0].id,before.episodes[0].id);
  const next=taskNodeInput(s,taskFixture(s.project,'script-split',p.id),null,'generate');assert.equal(next.script,adapted);
 });
});

test('只审核不会生成或改写，拒绝后也不自动修订，重新审核通过保持版本及下游有效',async()=>{
 let reject=true,calls=0;await run({chat:async({step,trace})=>{calls++;assert.equal(step.kind,'review');assert.equal(trace.input.content,original);return reject?{是否通过:false,类型:'模型问题',原因:'当前正文设施操作前后冲突，请按意见改编。'}:passed;}},async({p,submit})=>{
  const before=structuredClone(p.script);let result=await submit('generate');assert.equal(result.task.task_status,'rejected');assert.equal(calls,1);
  assert.equal(result.s.project.script.body,before.body);assert.equal(result.s.project.script.version,before.version);assert.deepEqual(result.s.project.script.revision_history,before.revision_history);
  assert.equal(result.s.steps.filter(st=>st.task_id===result.task.id&&['generate','revise'].includes(st.kind)).length,0);
  reject=false;result=await submit('regenerate');assert.equal(result.task.task_status,'completed',result.task.end_reason);assert.equal(calls,2);
  assert.equal(result.s.project.script.body,before.body);assert.equal(result.s.project.script.version,before.version);
  assert.equal(isNodeCurrent(result.s,'project-summary',p.id),true);assert.equal(isNodeCurrent(result.s,'project-characters',p.id),true);
 });
});

test('改编审核拒绝后以最新候选自动修订，执行意见始终保留，最终只记一次正文版本',async()=>{
 let reviews=0;const drafts=[];await run({chat:async({step,trace})=>{
  if(step.kind==='review')return ++reviews===1?{是否通过:false,类型:'模型问题',原因:'探月器操作仍有旧设定，请检查当前候选。'}:passed;
  drafts.push(trace.input);return drafts.length===1?'哥伦比亚号探月器等待炮口装填。':adapted;
 }},async({p,submit})=>{const {s,task}=await submit('revise',opinion);assert.equal(task.task_status,'completed',task.end_reason);assert.equal(drafts.length,2);assert.equal(drafts[1].content,'哥伦比亚号探月器等待炮口装填。');assert.ok(drafts[1].opinion.includes(opinion));assert.match(drafts[1].opinion,/旧设定/);assert.equal(s.project.script.version,p.script.version+1);assert.equal(s.project.script.revision_history.length,p.script.revision_history.length+1);});
});

test('改编与规划补充规则独立，基础仅由代码维护，三动作约束共享且授权设定优先',async()=>{
 await run({chat:async()=>passed},async({p,model,runtime})=>{
  const planning=structuredClone(p.script.rules),sid=`session-${crypto.randomUUID()}`;await runtime.bindings.bind(sid,p.id);
  for(const action of ['generate','review','revise'])await runtime.projectCommand({type:'edit-rule',project_id:p.id,business_type:'script-review',target_id:p.id,action,field:'supplement',value:`独立改编_${action}`,request_id:crypto.randomUUID()},sid,'panel');
  const s=model.readAll();assert.deepEqual(s.project.script.rules,planning);
  assert.equal(ruleNode(s.project,'script-review',p.id).rules.review.supplement,'独立改编_review');
  for(const action of ['generate','review','regenerate']){
   const task=taskFixture(s.project,'script-review',p.id,{action:'revise',opinion});
   const prompt=composeNodePrompt('script-review',action,taskNodeInput(s,task,{body:original},action),'codex-gpt');
   assert.match(prompt.system,/明确授权的设定变化优先于旧剧本/);assert.match(prompt.system,/不能只换名称/);
   assert.ok(prompt.system.includes(`独立改编_${action==='regenerate'?'revise':action}`));
   assert.equal(prompt.system.split('专用设施不能套成外观相似的普通物件').length,2);
  }
  await assert.rejects(runtime.projectCommand({type:'sync-base-rules',project_id:p.id,business_type:'script-review',target_id:p.id,request_id:crypto.randomUUID()},sid,'panel'),/已移除同步操作/);
  const current=model.readAll().project;assert.deepEqual(current.script.rules,planning);assert.equal(current.script.adaptation_rules.revise.supplement,'独立改编_revise');assert.equal(current.script.adaptation_rules.revise.base,defaultRules('script-review').revise.base);
 });
});

test('v26显式迁移仅补改编规则，保留正文规划和有效下游，二次启动不重写',async()=>{
 const home=await mkdtemp(join(tmpdir(),'meiji-script-migrate-'));let repo;
 try{
  const p=fixture();p.script.rules.review.supplement='原规划自定义';repo=new ModelRepository(home);await repo.create(p);await repo.close();repo=null;
  const db=new DatabaseSync(join(home,'meiji.sqlite')),old=structuredClone(p);delete old.script.adaptation_rules;
  db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(old),p.id);db.exec('DELETE FROM schema_migrations WHERE version=27; PRAGMA user_version=26');db.close();
  repo=new ModelRepository(home);const first=(await repo.open(p.id)).read();assert.deepEqual(first.project,{...old,script:{...old.script,adaptation_rules:defaultRules('script-review')}});assert.equal(isNodeCurrent(first,'project-summary',p.id),true);
  const revision=first.runtime.revision;await repo.close();repo=new ModelRepository(home);const second=(await repo.open(p.id)).read();assert.deepEqual(second.project,first.project);assert.equal(second.runtime.revision,revision);
 }finally{await repo?.close();await rm(home,{recursive:true,force:true});}
});

test('改编任务重启恢复直接读取已生成全文候选，不需要重新生成',()=>{
 const p=fixture(),task=taskFixture(p,'script-review',p.id,{action:'revise',opinion});
 const state=resumeState({project:p,steps:[{task_id:task.id,seq:2,kind:'generate',step_status:'done',result:adapted}]},task);
 assert.deepEqual(state.draft,{body:adapted});assert.equal(state.validationFailure,'');assert.equal(p.script.body,original);
});

test('剧本详情提供改编、审核、规则和意见，空意见不能提交改编',async()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document,previousFetch=globalThis.fetch,commands=[];globalThis.document=dom.window.document;
 globalThis.fetch=async(url,options)=>{commands.push(JSON.parse(options.body).command);return{ok:true,json:async()=>({content:false})};};
 try{
  const p=fixture(),root=document.querySelector('main'),errors=[];
  renderTaskPanel(root,{project:p,tasks:[],steps:[],groups:[]},{session_id:'s',view:{page:'script'},refresh:async()=>{},onError:message=>errors.push(message)});
  const card=root.querySelector('[data-business="script-review"]');assert.ok(card);assert.ok(card.querySelector('[aria-label="本次执行意见"]'));
  for(const label of ['按意见改编','审核剧本','查看规则','人工编辑','任务历史'])assert.ok([...card.querySelectorAll('button')].some(b=>b.textContent===label),label);
  [...card.querySelectorAll('button')].find(b=>b.textContent==='按意见改编').click();await new Promise(resolve=>setTimeout(resolve,0));assert.match(errors[0],/填写改编要求/);assert.equal(commands.length,0);
  const input=card.querySelector('[aria-label="本次执行意见"]');input.value=opinion;input.dispatchEvent(new dom.window.Event('input'));
  [...card.querySelectorAll('button')].find(b=>b.textContent==='按意见改编').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(commands[0].action,'revise');assert.equal(commands[0].opinion,opinion);assert.equal(commands[0].business_type,'script-review');
  [...card.querySelectorAll('button')].find(b=>b.textContent==='审核剧本').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(commands[1].action,'regenerate');assert.equal(commands[1].opinion,opinion);
 }finally{globalThis.document=previous;globalThis.fetch=previousFetch;dom.window.close();}
});

test('概览剧本卡片显式改编入口跳转到带意见和审核操作的详情，不发送AI请求',()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  const p=fixture(),root=document.querySelector('main'),snapshot={project:p,tasks:[],steps:[],groups:[]};
  const context={session_id:'s',view:{page:'overview'},refresh:async()=>{},onError:assert.fail,paint:()=>renderTaskPanel(root,snapshot,context)};
  context.paint();
  const card=[...root.querySelectorAll('.overview-card')].find(card=>card.querySelector('h3')?.textContent==='剧本');
  const entry=[...card.querySelectorAll('button')].find(button=>button.textContent==='改编剧本');assert.ok(entry);
  entry.click();assert.equal(context.view.page,'script');
  const detail=root.querySelector('[data-business="script-review"]');assert.ok(detail);
  assert.ok(detail.querySelector('[aria-label="本次执行意见"]'));
  for(const label of ['按意见改编','审核剧本'])assert.ok([...detail.querySelectorAll('button')].some(button=>button.textContent===label));
 }finally{globalThis.document=previous;dom.window.close();}
});
