import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {MemoryConversations,conversationUnits} from '../src/memory/conversations.js'
import {mediaMemory,modelMemoryEntry} from '../src/memory/service.js'
import {fixture,defaultAuthor,call,reply} from './helpers/production-fixture.js'

function author({generate,review}={}){return async(body,ctx)=>{
 const catalog=JSON.parse(body.messages[1].content);if(!catalog.mode)return defaultAuthor(body,ctx)
 if(!body.messages.some(m=>(m.tool_calls||[]).some(c=>c.function.name==='read_skill')))return reply([call('read_skill')])
 const calls=new Map(body.messages.flatMap(m=>m.tool_calls||[]).map(c=>[c.id,c])),results=body.messages.filter(m=>m.role==='tool').map(m=>({name:calls.get(m.tool_call_id)?.function.name,args:JSON.parse(calls.get(m.tool_call_id)?.function.arguments||'{}'),value:JSON.parse(m.content)}))
 const unit=results.find(r=>r.name==='read_unit'&&!r.value.error)?.value
 if(!unit)return reply([call('read_unit')])
 if(catalog.has_candidate&&!results.some(r=>r.name==='read_candidate'&&!r.value.error))return reply([call('read_candidate')])
 const missing=(unit.existing_index||[]).filter(e=>!results.some(r=>r.name==='read_existing'&&r.value.id===e.id));if(missing.length)return reply(missing.slice(0,3).map(e=>call('read_existing',{id:e.id})))
 const candidate=results.find(r=>r.name==='read_candidate'&&!r.value.error)?.value
 const existing=results.filter(r=>r.name==='read_existing'&&!r.value.error).map(r=>r.value)
 let output
 if(catalog.action==='review')output=review?await review({catalog,unit,candidate,existing,body,ctx}):{status:'passed',issues:[]}
 else if(unit.mode==='compress')output={summary:unit.rows.map(r=>r.content||r.summary).join('；').slice(0,1700)||'无适用内容',represented:unit.rows.map(r=>r.id)}
 else output=generate?await generate({catalog,unit,existing,body,ctx}):{operations:[]}
 return reply([call('submit',{output})])
}}
const operation=(row,values={})=>({action:'add',key:'tone',title:'张飞表达',content:'张飞保持沉稳，不要大喊。',kind:'decision',stages:[],target_ids:[],evidence:[{turn_id:row.turn_id,quote:row.text}],...values})
async function put(f,key,content,kind='preference'){const read=await f.projects.memories.read('project',{},f.context);return f.projects.memories.change('project',{key,title:key,content,kind,stages:[],expected_revision:read.revision,user_quote:content.slice(0,2000)},f.context)}
async function run(f,input){const started=await f.production.memoryMaintenance.run({...input,request_id:randomUUID()},f.context),detail=await f.production.memoryMaintenance.wait(started.group_id);assert.equal(detail.status,'completed',detail.reason);return detail}

test('用户对话提炼保留引文，助手/代码内容不自动成为决定；重复窗口与消息ID去重',async t=>{
 const f=await fixture(t,{author:author({generate:({unit})=>({operations:unit.rows[0].text.includes('张飞')?[operation(unit.rows[0])]:[]})})}),journal=f.production.memoryMaintenance.conversations
 await journal.append(f.context,[{id:'system',role:'system',content:'内部提示'},{id:'a1',role:'assistant',content:'建议增加爆炸场面'},{id:'u1',role:'user',content:'记住：张飞保持沉稳，不要大喊。'},{id:'u2',role:'user',content:'代码使用TypeScript。'}]);assert.equal((await journal.read(f.context)).messages.length,3)
 const result=await run(f,{action:'extract',scope:'project'}),entries=await f.projects.memories.entriesFor('project',f.context);assert.equal(entries.length,1);assert.ok(f.requests[0].body.messages[1].content.includes('skill_index'));assert.ok(!JSON.stringify(f.requests[0].body.messages).includes('张飞保持沉稳'));assert.ok(entries[0].source.citations[0].turn_id);assert.equal(entries[0].source.maintenance_task_id,result.tasks[0].id);assert.ok(!JSON.stringify(entries).includes('爆炸'));assert.ok(!JSON.stringify(entries).includes('TypeScript'));assert.equal((await journal.pending(f.context)).length,0)
 const restored=new MemoryConversations(f.projects);assert.equal((await restored.append(f.context,[{id:'u2',role:'user',content:'代码使用TypeScript。'}])).added,0)
 const repeat=await f.production.memoryMaintenance.run({action:'extract',scope:'project'},f.context);assert.equal(repeat.group_id,null)
})

test('错误用户引文被程序拒绝，独立审核可要求修订且不继承作者提交',async t=>{
 const bad=await fixture(t,{author:author({generate:({unit})=>({operations:[operation(unit.rows[0],{evidence:[{turn_id:unit.rows[0].turn_id,quote:'伪造用户原话'}]})]})})});let job=await bad.production.memoryMaintenance.run({action:'extract',scope:'project',turns:[{role:'user',text:'张飞保持沉稳。'}]},bad.context),detail=await bad.production.memoryMaintenance.wait(job.group_id);assert.equal(detail.status,'failed');assert.match(detail.reason,/证据|原文/);assert.equal((await bad.projects.memories.read('project',{},bad.context)).total,0)
 let reviews=0;const f=await fixture(t,{author:author({generate:({unit})=>({operations:[operation(unit.rows[0])]}),review:({body})=>{assert.ok(!body.messages.some(m=>(m.tool_calls||[]).some(c=>c.function.name==='submit'&&c.function.arguments.includes('operations'))));return ++reviews===1?{status:'needs_changes',issues:['保留不要大喊这一否定限制']}:{status:'passed',issues:[]}}})});detail=await run(f,{action:'extract',scope:'project',turns:[{role:'user',text:'张飞保持沉稳，不要大喊。'}]});assert.ok(detail.steps.some(s=>s.round===1));assert.equal((await f.projects.memories.entriesFor('project',f.context)).length,1)
})

test('工程仅提炼明确跨Drama偏好；宿主观察按阈值自动执行且不重复',async t=>{
 const f=await fixture(t,{author:author({generate:({catalog,unit})=>({operations:catalog.scope==='engineering'?[operation(unit.rows[0],{key:'music',title:'配乐偏好',kind:'preference',content:'所有Drama项目都不要背景音乐。',global_quote:unit.rows[0].text})]:[]})})}),options={sessionId:null,purpose:'conversation',messages:[{id:'u-global',role:'user',content:'以后所有Drama项目都不要背景音乐。'}]};options.sessionId=f.context.sessionId
 await f.production.memoryMaintenance.observe(options);assert.equal((await f.projects.memories.read('engineering',{},f.context)).total,1);assert.equal((await f.projects.memories.read('project',{},f.context)).total,0);const count=f.requests.length;await f.production.memoryMaintenance.observe(options);assert.equal(f.requests.length,count)
 await f.production.memoryMaintenance.observe({...options,sessionId:'other-plugin'});assert.equal(f.requests.length,count)
})

test('语义重复合并保留原文，含糊冲突变为未决问题；明确失效才归档',async t=>{
 let mode='merge';const f=await fixture(t,{author:author({generate:({existing,unit})=>({operations:[operation(unit.rows[0]||{turn_id:'',text:''},{action:mode,key:'tone',title:'人物表达',kind:mode==='conflict'?'open_question':'decision',content:mode==='merge'?existing.map(e=>e.content).join('；'):'两项表达要求是否同时适用，待用户确认。',target_ids:mode==='merge'?existing.slice(0,2).map(e=>e.id):[existing[0].id],evidence:[]})]})})});await put(f,'tone1','张飞保持沉稳。','decision');await put(f,'tone2','张飞不要大喊。','decision');await run(f,{action:'reconcile',scope:'project'});let entries=await f.projects.memories.entriesFor('project',f.context);assert.equal(entries.length,1);assert.ok(entries[0].content.includes('不要大喊'))
 mode='conflict';await run(f,{action:'reconcile',scope:'project'});entries=await f.projects.memories.entriesFor('project',f.context);assert.ok(entries.some(e=>e.kind==='open_question'));assert.ok(entries.some(e=>e.kind==='decision'))
 const before=(await f.projects.memories.read('project',{},f.context)).revision;await assert.rejects(f.projects.memories.changeBatch('project',[{key:'ok',title:'ok',content:'配乐轻',kind:'preference',stages:[],user_quote:'配乐轻'},{key:'bad',title:'bad',content:'',kind:'preference',stages:[],user_quote:'空'}],before,f.context),/正文/);assert.equal((await f.projects.memories.read('project',{},f.context)).revision,before)
})

test('长记忆有界分块/层级压缩，覆盖全部来源并保留硬约束，修改后摘要失效',async t=>{
 const f=await fixture(t,{author:author()});for(let i=0;i<28;i++)await put(f,'pref_'+i,`偏好${i}：`+'画面细腻，保持人物辨识度。'.repeat(90));await put(f,'weapon','张飞不得使用火器，始终使用蛇矛。','constraint')
 const original=await f.projects.memories.entriesFor('project',f.context),detail=await run(f,{action:'compress',scope:'project'}),snapshot=await f.projects.memories.capture(f.context,'video_render');assert.ok(snapshot.digest);assert.equal(snapshot.digest.source_ids.length,29);assert.deepEqual(snapshot.entries,original.sort((a,b)=>a.key.localeCompare(b.key)));assert.ok(detail.steps.filter(s=>s.kind==='review').length>2)
 const memory_ref=await f.projects.documents.writeArtifact(f.context.projectId,JSON.stringify(snapshot),{extension:'json'}),prompt=await mediaMemory(f.projects,{node_type:'video_render',metadata:{project_id:f.context.projectId,memory_snapshot_ref:memory_ref}});assert.ok(prompt.includes('张飞不得使用火器，始终使用蛇矛。'));assert.ok(prompt.length<12000)
 const calls=f.requests.filter(r=>r.path==='/chat/completions').map(r=>r.body);assert.ok(calls.every(c=>JSON.stringify(c.messages).length<85000));await put(f,'pref_0','更换为冷色');assert.equal((await f.projects.memories.capture(f.context,'video_render')).digest,undefined)
})

test('取消和压缩期间人工修改不覆盖记忆；日志长页覆盖UTF16完整',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),normal=author();const f=await fixture(t,{author:async(body,ctx)=>{if(JSON.parse(body.messages[1].content).mode){entered();await gate}return normal(body,ctx)}});await put(f,'voice','男声低沉');const job=await f.production.memoryMaintenance.run({action:'compress',scope:'project'},f.context);await started;await f.production.memoryMaintenance.cancel(job.group_id,f.context);release();assert.equal((await f.production.memoryMaintenance.wait(job.group_id)).status,'cancelled');assert.equal((await f.projects.memories.read('project',{summary:true},f.context)).digest,null)
 const source='用户明确要求😀。'.repeat(3000),pages=conversationUnits([{id:'long',role:'user',text:source}]);assert.equal(pages.map(p=>p.text).join(''),source);assert.ok(pages.every(p=>p.text.length<=6000&&!/[\uD800-\uDBFF]$/.test(p.text)))
})

test('同主题不能新增覆盖；明确替代/取消保留历史，工程含糊冲突保留旧偏好',async t=>{
 let action='supersede';const f=await fixture(t,{author:author({generate:({unit,existing})=>({operations:[operation(unit.rows[0],{action,target_ids:[existing[0].id],content:'张飞只在高潮爆发。'})]})})});await put(f,'tone','张飞始终沉稳。','decision');const old=(await f.projects.memories.entriesFor('project',f.context))[0]
 const unit={mode:'extract',existing:[old],messages:[{id:'u',role:'user',text:'张飞只在高潮爆发。'}]};assert.throws(()=>f.production.memoryMaintenance.validate(unit,{operations:[operation({turn_id:'u',text:'张飞只在高潮爆发。'})]},'project',new Set([old.id])),/主题已存在/)
 await run(f,{action:'extract',scope:'project',turns:[{role:'user',text:'改为：张飞只在高潮爆发。'}]});let memory=await f.projects.memories.read('project',{id:old.id},f.context);assert.equal(memory.entry.content,'张飞只在高潮爆发。');assert.ok(JSON.stringify(await f.projects.memories.read('project',{history:true},f.context)).includes('张飞始终沉稳。'))
 action='archive';await run(f,{action:'extract',scope:'project',turns:[{role:'user',text:'取消张飞只在高潮爆发的要求。'}]});assert.equal((await f.projects.memories.read('project',{id:old.id},f.context)).entry.status,'archived')
 const service=f.production.memoryMaintenance,global=await f.projects.memories.change('engineering',{key:'music',title:'配乐',content:'轻配乐',kind:'preference',stages:[],user_quote:'所有Drama项目使用轻配乐',expected_revision:0},f.context);const entry=global.entry,plan={operations:[operation({turn_id:'',text:''},{action:'conflict',target_ids:[entry.id],evidence:[],content:'配乐需求冲突',kind:'open_question'})]};service.validate({mode:'reconcile',existing:[entry],messages:[]},plan,'engineering',new Set([entry.id]));assert.equal(service.commands({scope:'engineering',entries:[entry]},[plan],{}).filter(c=>c.unresolved).length,1);assert.equal((await f.projects.memories.read('engineering',{id:entry.id},f.context)).entry.content,'轻配乐')
})

test('压缩漏来源被拒绝，压缩中人工改动不会发布旧摘要',async t=>{
 const f=await fixture(t,{author:author()});await put(f,'tone','沉稳');const service=f.production.memoryMaintenance;assert.throws(()=>service.validate({mode:'compress',rows:[{id:'one'},{id:'two'}]},{summary:'沉稳',represented:['one']},'project',new Set()),/完整覆盖/)
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);service.client={turn:async()=>{entered();await gate;return reply([call('read_unit')])}};const job=await service.run({action:'compress',scope:'project'},f.context);await started;await put(f,'tone','热血');service.client=undefined;release();const detail=await service.wait(job.group_id);assert.equal(detail.status,'failed');assert.match(detail.reason,/记忆已变化/);assert.equal((await f.projects.memories.read('project',{summary:true},f.context)).digest,null)
})

test('整理harness-http检查标识/归属/幂等并分页原始记录，长记忆制作前自动压缩冻结',async t=>{
 const f=await fixture(t,{author:author()});for(let i=0;i<25;i++)await put(f,'pref'+i,'视觉偏好'+i)
 await f.run('source_analysis');const detail=await f.run('adaptation_plan'),snapshot=JSON.parse((await f.projects.documents.readArtifact(f.context.projectId,detail.tasks[0].metadata.memory_snapshot_ref)).toString());assert.equal(snapshot.digest.source_ids.length,25);assert.ok(f.calls.some(c=>c.stage==='adaptation_plan'&&c.messages[1].content.includes('memory_brief')))
 const url=`${f.api}/production-memory-maintenance?session_id=${f.context.sessionId}&scope=project`,input={action:'compress',scope:'project',request_id:'repeat'}
 let response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,403)
 const post=async value=>(await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-drama-request':'1'},body:JSON.stringify(value)})).json();const first=await post(input);await f.production.memoryMaintenance.wait(first.group_id);assert.equal((await post(input)).group_id,first.group_id);assert.match((await post({...input,action:'reconcile'})).message,/同一请求/)
 const history=await(await fetch(url)).json();assert.ok(history.entries.some(e=>e.id===first.group_id));const status=await(await fetch(url+'&id='+first.group_id)).json(),file=status.tasks[0].metadata.input_ref;response=await fetch(url+'&id='+first.group_id+'&file='+file+'&start=0');const page=await response.json();assert.ok(page.body.length<=16000);assert.ok(page.characters>=page.body.length);response=await fetch(url+'&id='+first.group_id+'&file=../../secret');assert.equal(response.status,422)
 response=await fetch(url.replace(f.context.sessionId,'wrong')+'&id='+first.group_id);assert.notEqual(response.status,200)
})


test('续接旧任务保留原快照，不为后来新增的长记忆启动压缩',async t=>{
 let fail=true;const normal=author(),f=await fixture(t,{author:async(body,ctx)=>{const catalog=JSON.parse(body.messages[1].content);if(!catalog.mode&&fail)throw new Error('模拟文本服务失败');return normal(body,ctx)}})
 await f.run('source_analysis');const started=await f.production.run('adaptation_plan',{}, {...f.context,requestId:randomUUID()}),failed=await f.production.wait(started.group_id);assert.equal(failed.status,'failed');for(let i=0;i<25;i++)await put(f,'later_'+i,'后来的视频偏好'+i);fail=false;const resumed=await f.run('adaptation_plan',{resume_of:started.group_id});assert.equal(resumed.tasks[0].metadata.memory_snapshot_ref,failed.tasks[0].metadata.memory_snapshot_ref);assert.equal((await f.production.memoryMaintenance.history(f.context,'project')).entries.length,0)
})


test('同批重复要求只存一项并合并来源，大量来源引文不会阻断正文读取',async t=>{
 const f=await fixture(t,{author:author({generate:({unit})=>({operations:[operation(unit.rows[0])]})})});await run(f,{action:'extract',scope:'project',turns:[{role:'user',text:'记住张飞沉稳，不要大喊。'},{role:'assistant',text:'已记录'},{role:'user',text:'再次强调张飞沉稳，不要大喊。'}]});const data=await f.projects.memories.entriesFor('project',f.context);assert.equal(data.length,1);assert.equal(data[0].source.citations.length,2)
 const source={...data[0],source:{...data[0].source,citations:Array.from({length:200},(_,i)=>({turn_id:'u'+i,quote:'用户原文'.repeat(300)}))}},view=modelMemoryEntry(source);assert.equal(view.content,source.content);assert.equal(view.source.citation_count,200);assert.ok(JSON.stringify(view).length<16000);assert.equal(source.source.citations.length,200)
})
