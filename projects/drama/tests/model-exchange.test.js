import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {createPanelTaskDisplay} from '../src/main_agent/session/panel_task_messages.js'
import {createTaskOperation,groupTaskMessages} from '../src/client/ui/task-operation.js'
import {compactDisplay} from '../src/main_agent/session/task_display_context.js'
import {fixture} from './helpers/production-fixture.js'

const sent=[{role:'system',content:'当次完整规则'},{role:'user',content:'当次目标 <img src=x onerror=alert(1)>'},{role:'tool',tool_call_id:'previous',content:'上轮工具返回'}]
const call={id:'contract',type:'function',function:{name:'read_contract',arguments:'{}'}}
const trace={action:'generate',messages:[{role:'assistant',content:null,tool_calls:[call],reasoning_content:'不应展示的内部推理'}, {role:'tool',tool_call_id:'contract',content:'{"fields":["goal","plot_text"]}'}]}
function history({files={},noResponse=false}={}){
 const step={id:'step',task_id:'t',kind:'generate',executor:'ai',name:'generate',seq:2,step_status:noResponse?'failed':'done',prompt:{model:'codex-gpt',input:{messages_ref:'artifacts/messages.json'}},result:noResponse?null:{trace:{file_ref:'artifacts/trace.json'}}}
 const task={id:'t',node_type:'adaptation_plan',name:'联合改编',task_status:'completed',metadata:{document_version:3,project_id:'p_history'}},detail={group:{id:'g',source:'ui'},tasks:[task],steps:[step],status:'completed'}
 const events=[{type:'command/run',seq:1,data:{commandId:'event',name:'盒子步骤',args:JSON.stringify({kind:'drama-task-display',phase:'step',group_id:'g',task_id:'t',step_id:'step',seq:2,status:step.step_status,label:'已结束'})}},{type:'command/done',data:{commandId:'event',kind:'success'}}],reads=[]
 const records={'artifacts/messages.json':sent,'artifacts/trace.json':trace,...files}
 const projects={records:{scope:'drama',tasks:{detail:()=>structuredClone(detail)}},documents:{readArtifact:async(project,ref)=>{assert.equal(project,'p_history');reads.push(ref);if(records[ref]===null)throw Error('ENOENT');return Buffer.from(JSON.stringify(records[ref]))}},snapshot:()=>{throw Error('不能读取当前短剧')}}
 const display=createPanelTaskDisplay({sessionController:{resolveAgent:async()=>({agent:{session:{snapshotEvents:()=>events}}})}},projects)
 return {display,reads,step,task,detail,projects}
}

test('模型交互按历史任务恢复完整消息，assistant与工具分离，轮询不载入正文',async()=>{
 const f=history(),before=structuredClone(f.detail)
 const compact=await f.display.read('session',{compact:true,eager:true})
 assert.equal(compact.messages[0].model_call.model,'codex-gpt');assert.equal(compact.details[0].model_exchange,undefined);assert.ok(!f.reads.includes('artifacts/messages.json'))
 const [card]=await f.display.read('session',{id:'event'})
 assert.deepEqual(card.model_exchange.request.messages,sent);assert.deepEqual(card.model_exchange.response.messages,[{role:'assistant',content:null,tool_calls:[call]}]);assert.equal(card.model_exchange.tools[0].result.content,trace.messages[1].content);assert.equal(card.model_exchange.tools[0].status,'done')
 assert.equal(compactDisplay(card).model_exchange,undefined);assert.deepEqual(f.detail,before)
})

test('缺文件、无模型返回、部分工具失败和无工具文本响应如实展示',async()=>{
 const missing=history({files:{'artifacts/messages.json':null}}),[broken]=await missing.display.read('session',{id:'event'})
 assert.match(broken.model_exchange.request.error,/暂不可读取/);assert.equal(broken.model_exchange.request.messages,null);assert.equal(broken.model_exchange.response.messages.length,1)
 const [failed]=await history({noResponse:true}).display.read('session',{id:'event'});assert.match(failed.model_exchange.response.error,/未保存/);assert.deepEqual(failed.model_exchange.tools,[])
 const t={...trace,messages:[trace.messages[0],{role:'tool',tool_call_id:'contract',content:'{"error":"输出契约暂不可读取"}'}]},[toolError]=await history({files:{'artifacts/trace.json':t}}).display.read('session',{id:'event'});assert.equal(toolError.model_exchange.tools[0].status,'failed')
 const [pending]=await history({files:{'artifacts/trace.json':{messages:[trace.messages[0]]}}}).display.read('session',{id:'event'});assert.equal(pending.model_exchange.tools[0].status,'pending')
 const [text]=await history({files:{'artifacts/trace.json':{messages:[{role:'assistant',content:'普通回复'},{role:'user',content:'请通过工具提交'}]}}}).display.read('session',{id:'event'});assert.equal(text.model_exchange.response.messages[0].content,'普通回复');assert.deepEqual(text.model_exchange.tools,[]);assert.equal(text.model_exchange.program_messages.length,1)
})

test('步骤默认展示三段摘要，展开实际消息与工具，HTML按文本展示',async t=>{
 const f=history(),[card]=await f.display.read('session',{id:'event'}),dom=new JSDOM('<main/>');t.after(()=>dom.window.close());let reads=0
 const ui=createTaskOperation(dom.window.document,{loadMessage:async()=>{reads++;return card},getMessage:()=>null,copy:async()=>{},onNotify:()=>{}});t.after(()=>ui.dispose());dom.window.document.querySelector('main').append(ui.element);ui.update(groupTaskMessages([compactDisplay(card)])[0]);const root=ui.element.shadowRoot
 assert.match(root.querySelector('.exchange-overview').textContent,/发送 · 联合改编.*模型返回 · 工具调用 · read_contract — 查看输出字段要求.*工具执行 · read_contract · 已完成/);assert.equal(root.querySelectorAll('.activity-events').length,0);assert.equal(reads,0);assert.equal(root.querySelector('.step').open,false)
 const step=root.querySelector('.step');step.open=true;await step.ontoggle();assert.equal(reads,1)
 assert.deepEqual([...step.querySelectorAll('.exchange-section>h4')].map(el=>el.textContent),['1. 发送给模型','2. 模型返回','3. 程序执行工具'])
 assert.match(step.textContent,/当次完整规则|上轮工具返回|read_contract|fields/);assert.doesNotMatch(step.textContent,/不应展示的内部推理|完整输入记录|完整输出记录/);assert.equal(root.querySelector('img'),null)
 assert.match(step.querySelector('[data-expand=sent-0]>summary').textContent,/系统规则（system）/);assert.match(step.querySelector('[data-expand=sent-1]>summary').textContent,/任务或反馈（user）/);assert.equal(step.querySelector('[data-expand=sent-0]').open,false)
 const response=step.querySelector('[data-expand=received-0]'),tool=step.querySelector('[data-expand=tool-0]');assert.equal(response.open,true);assert.match(response.querySelector('summary').textContent,/模型消息（assistant） - tool_calls/);assert.equal(tool.open,true)
 const result=[...tool.querySelectorAll('.payload')].find(el=>el.querySelector('h4')?.textContent==='程序执行结果');assert.deepEqual(JSON.parse(result.querySelector('pre').textContent),{fields:['goal','plot_text']});assert.equal(tool.querySelector('[data-expand=raw-tool-0]').open,false)
})

test('收起摘要保留当次目标，多个工具的错误和未返回不冒充完成',async t=>{
 const f=history();f.task.metadata.instruction='按原著制定改编原则';const [card]=await f.display.read('s',{compact:true});assert.equal(card.model_call.goal,'按原著制定改编原则')
 const dom=new JSDOM('<main/>');t.after(()=>dom.window.close());const ui=createTaskOperation(dom.window.document,{getMessage:()=>null,loadMessage:async()=>{throw Error('摘要不得读取详情')},copy:async()=>{},onNotify:()=>{}});t.after(()=>ui.dispose())
 ui.update(groupTaskMessages([{...card,activities:[{tool:'read_skill',title:'读取生成规则',status:'failed',detail:'文件不可读取'},{tool:'read_unit',title:'查看本次任务资料',status:'pending',detail:'尚无工具返回记录'}]}])[0]);const root=ui.element.shadowRoot,text=root.querySelector('.exchange-overview').textContent
 assert.match(text,/发送 · 按原著制定改编原则/);assert.match(text,/工具调用 · read_skill — 读取生成规则；read_unit — 查看本次任务资料/);assert.match(text,/read_skill · 失败 · 文件不可读取/);assert.match(text,/read_unit · 尚未确认返回/);assert.doesNotMatch(text,/已完成/)
 ui.update(groupTaskMessages([{...card,activities:[]}])[0]);assert.match(root.querySelector('.exchange-overview').textContent,/未记录工具调用，展开查看返回内容/)
 ui.update(groupTaskMessages([{...card,activities:[],activity_notice:'记录缺失'}])[0]);assert.match(root.querySelector('.exchange-overview').textContent,/工具调用记录暂不可读取.*执行记录暂不可读取/)
})

test('混合模型返回明确标注content与tool_calls，纯文本不冒充工具调用',async t=>{
 const dom=new JSDOM('<main/>');t.after(()=>dom.window.close());const f=history({files:{'artifacts/trace.json':{messages:[{role:'assistant',content:'先读取契约',tool_calls:[call]},trace.messages[1]]}}}),[card]=await f.display.read('s',{id:'event'})
 const ui=createTaskOperation(dom.window.document,{getMessage:()=>card,copy:async()=>{},onNotify:()=>{}});t.after(()=>ui.dispose());ui.update(groupTaskMessages([compactDisplay(card)])[0]);const root=ui.element.shadowRoot,step=root.querySelector('.step');step.open=true;await step.ontoggle()
 assert.match(step.querySelector('[data-expand=received-0]>summary').textContent,/content \+ tool_calls/);assert.match(step.querySelector('[data-expand=received-0]').textContent,/先读取契约/)
 card.model_exchange.response.messages=[{role:'assistant',content:'仅文本返回'}];ui.update(groupTaskMessages([{...compactDisplay(card),label:'更新'}])[0]);const current=root.querySelector('.step');await current.ontoggle();assert.match(current.querySelector('[data-expand=received-0]>summary').textContent,/ - content$/);assert.doesNotMatch(current.querySelector('[data-expand=received-0]>summary').textContent,/tool_calls/)
})

test('真实模拟调用保存的请求与当轮trace可按三个部分还原',async t=>{
 const f=await fixture(t);await f.run('source_analysis');const detail=await f.run('adaptation_plan'),task=detail.tasks[0],steps=detail.steps.filter(step=>step.prompt?.input?.messages_ref)
 assert.ok(steps.length>=4)
 for(const step of steps){
  const request=JSON.parse((await f.projects.documents.readArtifact(f.context.projectId,step.prompt.input.messages_ref)).toString()),trace=JSON.parse((await f.projects.documents.readArtifact(f.context.projectId,step.result.trace.file_ref)).toString())
  const events=[{type:'command/run',data:{commandId:step.id,name:'盒子步骤',args:JSON.stringify({kind:'drama-task-display',phase:'step',group_id:detail.group.id,task_id:task.id,step_id:step.id})}},{type:'command/done',data:{commandId:step.id}}]
  const display=createPanelTaskDisplay({sessionController:{resolveAgent:async()=>({agent:{session:{snapshotEvents:()=>events}}})}},f.projects),[card]=await display.read('s',{id:step.id})
  assert.deepEqual(card.model_exchange.request.messages,request);assert.equal(card.model_exchange.response.messages.length,trace.messages.filter(m=>m.role==='assistant').length);assert.equal(card.model_exchange.tools.length,trace.messages.filter(m=>m.role==='assistant').flatMap(m=>m.tool_calls||[]).length)
 }
})
