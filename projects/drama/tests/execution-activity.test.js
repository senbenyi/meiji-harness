import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {executionActivities,stepExecutionName} from '../src/shared/agent/execution_activity.js'
import {createTaskOperation,groupTaskMessages} from '../src/client/ui/task-operation.js'
import {createPanelTaskDisplay} from '../src/main_agent/session/panel_task_messages.js'
import {displayContext,compactDisplay} from '../src/main_agent/session/task_display_context.js'
import {fixture} from './helpers/production-fixture.js'
const call=(id,name,args)=>({id,function:{name,arguments:JSON.stringify(args)}})
const reply=(id,data)=>({role:'tool',tool_call_id:id,content:JSON.stringify(data)})
const trace={action:'generate',messages:[{role:'assistant',content:'不能把这段自由文本当成已完成操作',tool_calls:[call('a','read_skill',{}),call('b','read_source',{start:0,end:5933}),call('c','read_candidate',{start:0,end:100}),call('d','submit_candidate',{output:{goal:'<img src=x onerror=alert(1)>'}})]},reply('a',{content:'不泄露整份规则'}),reply('b',{body:'不要复制原著正文'}),reply('c',{error:'读取范围无效'}),reply('d',{accepted:true})]}

test('操作来自当轮工具返回，阶段/范围/错误中文展示且不包含正文或模型自由文本',()=>{
 const rows=executionActivities(trace);assert.deepEqual(rows.map(r=>r.status),['done','done','failed','done']);assert.equal(rows[0].title,'读取生成规则');assert.match(rows[1].detail,/1–5933/);assert.equal(rows[2].detail,'读取范围无效');assert.equal(rows[3].detail,'候选校验通过');assert.doesNotMatch(JSON.stringify(rows),/不要复制原著|不能把这段|不泄露整份|onerror/)
 assert.equal(stepExecutionName({kind:'review',name:'review'},{metadata:{document_version:3}}),'独立审核');assert.equal(stepExecutionName({kind:'review',name:'历史名称'},{metadata:{}}),'历史名称')
})

test('无工具返回和未接受提交不能显示完成，审核结论仅由实际提交确认',()=>{
 const pending=executionActivities({action:'review',messages:[{role:'assistant',tool_calls:[call('x','submit_review',{output:{status:'passed'}})]}]});assert.equal(pending[0].status,'pending')
 const passed=executionActivities({action:'review',messages:[{role:'assistant',tool_calls:[call('x','submit_review',{output:{status:'passed'}})]},reply('x',{accepted:true})]});assert.equal(passed[0].detail,'审核通过')
 const rejected=executionActivities({action:'review',messages:[{role:'assistant',tool_calls:[call('x','submit_review',{output:{status:'content_issue',issues:[{},{}]}})]},reply('x',{accepted:true})]});assert.equal(rejected[0].detail,'发现 2 项问题')
 const invalid=executionActivities({messages:[{role:'assistant',tool_calls:[call('x','submit_candidate',{})]},reply('x',{accepted:false})]});assert.equal(invalid[0].status,'pending')
 assert.deepEqual(executionActivities({messages:[{role:'assistant',content:'我已经读完原稿并审核通过'}]}),[])
})

test('时间线默认显示实际操作，详情保持折叠，用户折叠选择不被更新覆盖',t=>{
 const dom=new JSDOM('<main/>');t.after(()=>dom.window.close());const messages=[{id:'s',group_id:'g',phase:'step',seq:2,node_type:'adaptation_plan',step_kind:'generate',step_name:'生成内容',execution_detail_version:1,status:'done',label:'已完成',operation_status:'completed',activities:executionActivities(trace)}]
 const ui=createTaskOperation(dom.window.document,{getMessage:()=>null,loadMessage:async()=>({input:{original:'完整输入'},result:{}}),copy:async()=>{},onNotify:()=>{}});t.after(()=>ui.dispose());dom.window.document.querySelector('main').append(ui.element);ui.update(groupTaskMessages(messages)[0]);const root=ui.element.shadowRoot
 assert.equal(root.querySelector('[data-expand=process]').open,true);assert.equal(root.querySelector('.step').open,false);assert.equal(root.querySelectorAll('.activity-event').length,4);assert.match(root.textContent,/读取生成规则|第 1–5933 字符|读取范围无效/);assert.equal(root.querySelector('img'),null)
 root.querySelector('[data-expand=process]').open=false;ui.update(groupTaskMessages(messages.map(m=>({...m,label:'更新'})))[0]);assert.equal(root.querySelector('[data-expand=process]').open,false)
})

test('旧trace只从历史任务所属短剧恢复，compact保留摘要，缓存不改写历史',async()=>{
 const step={id:'step',task_id:'t',kind:'generate',name:'generate',seq:2,step_status:'done',result:{trace:{file_ref:'artifacts/trace.json'}}},task={id:'t',node_type:'adaptation_plan',name:'联合改编',task_status:'completed',metadata:{document_version:3,project_id:'p_history'}},detail={group:{id:'g',source:'ui'},tasks:[task],steps:[step],status:'completed'},before=structuredClone(detail)
 let reads=0;const events=[{type:'command/run',seq:1,data:{commandId:'event',name:'盒子步骤',args:JSON.stringify({kind:'drama-task-display',phase:'step',group_id:'g',task_id:'t',step_id:'step',seq:2,label:'已完成',status:'done'})}},{type:'command/done',data:{commandId:'event',kind:'success'}}]
 const projects={records:{scope:'drama',tasks:{detail:()=>structuredClone(detail)}},documents:{readArtifact:async(id,ref)=>{assert.equal(id,'p_history');assert.equal(ref,'artifacts/trace.json');reads++;return Buffer.from(JSON.stringify(trace))}},snapshot:()=>{throw Error('不得读取当前短剧')}}
 const ui=createPanelTaskDisplay({sessionController:{resolveAgent:async()=>({agent:{session:{snapshotEvents:()=>events}}})}},projects)
 const cards=await ui.read('session',{compact:true});assert.equal(cards[0].step_name,'生成内容');assert.equal(cards[0].activities.length,4);assert.equal(cards[0].result,undefined);await ui.read('session',{eager:true});assert.equal(reads,1);assert.deepEqual(detail,before)
 projects.documents.readArtifact=async()=>{throw new Error('ENOENT')}
 const missing=createPanelTaskDisplay({sessionController:{resolveAgent:async()=>({agent:{session:{snapshotEvents:()=>events}}})}},projects)
 assert.match((await missing.read('session',{compact:true}))[0].activity_notice,/暂不可读取/)
})

test('运行中显示实际阶段及等待本轮结果，缺失历史文件如实提示',async()=>{
 const task={id:'t',node_type:'adaptation_plan',name:'联合改编',task_status:'running',metadata:{document_version:3}},step={id:'s',task_id:'t',seq:1,name:'generate',kind:'generate',executor:'ai',step_status:'running'},detail={group:{id:'g'},tasks:[task],steps:[step],status:'running'}
 const context=displayContext(detail,task,step);assert.match(context.active_step.name,/生成内容，等待本轮调用结果/);assert.equal(compactDisplay(context).execution_detail_version,1)
})

test('模拟模型真实生成与独立审核步骤携带当轮动作，原trace可恢复同一摘要',async t=>{
 const f=await fixture(t);await f.run('source_analysis');const detail=await f.run('adaptation_plan'),steps=detail.steps.filter(s=>s.result?.trace)
 assert.ok(steps.length>=4);assert.ok(steps.some(s=>s.result.trace.activities.some(a=>a.title==='读取原著')));assert.ok(steps.some(s=>s.result.trace.activities.some(a=>a.title==='提交审核结论'&&a.detail==='审核通过')))
 for(const step of steps){const stored=JSON.parse((await f.projects.documents.readArtifact(f.context.projectId,step.result.trace.file_ref)).toString());assert.deepEqual(step.result.trace.activities,executionActivities(stored))}
})
