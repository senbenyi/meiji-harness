import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {MemoryService,searchMemory,mediaMemory} from '../src/memory/service.js'
import {ReadMemoryTool,WriteMemoryTool} from '../src/tools/memory_tools.js'
import {fixture,defaultAuthor,call,reply} from './helpers/production-fixture.js'

async function remember(f,scope,key,content,{stages=[],kind=scope==='engineering'?'preference':'decision',context=f.context}={}){
 const data=await f.projects.memories.read(scope,{},context)
 return f.projects.memories.change(scope,{action:'upsert',key,title:key,content,stages,kind,expected_revision:data.revision,user_quote:content},{...context,source:'conversation'})
}

test('两层记忆持久保存、Drama跨项目共享偏好、项目隔离及按主题/步骤覆盖',async t=>{
 const f=await fixture(t);await remember(f,'engineering','tone','工程克制表达');const own=await remember(f,'project','tone','本项目强烈表达',{stages:['shot_design']});await remember(f,'project','unresolved','人物结局待用户决定',{kind:'open_question',stages:['adaptation_plan']})
 assert.equal((await f.projects.memories.capture(f.context,'shot_design')).domain,'video_production');const restarted=new MemoryService(f.projects);assert.equal((await restarted.read('engineering',{}, {sessionId:'new-before-project'})).total,1);const p=(await restarted.read('project',{id:own.entry.id},f.context)).entry;assert.equal(p.content,'本项目强烈表达');assert.equal(p.source.user_quote,p.content)
 assert.equal((await restarted.capture(f.context,'shot_design')).entries.find(e=>e.key==='tone').scope,'project');assert.equal((await restarted.capture(f.context,'source_analysis')).entries.find(e=>e.key==='tone').scope,'engineering')
 const other=await f.projects.create({name:'第二个项目'},{sessionId:f.context.sessionId,requestId:randomUUID()}),context={sessionId:other.session_id,projectId:other.project_id},merged=await restarted.capture(context,'shot_design');assert.equal(merged.entries.length,1);assert.equal(merged.entries[0].content,'工程克制表达')
 await assert.rejects(restarted.read('project',{}, {...context,projectId:f.context.projectId}),/绑定/);await assert.rejects(remember(f,'engineering','bad','工程不允许故事决定',{kind:'decision'}),/工程记忆仅/)
 const read=new ReadMemoryTool(f.projects),write=new WriteMemoryTool(f.projects),exec={agent:{session:{id:f.context.sessionId}}};assert.equal(JSON.parse(await read.execute({scope:'project',id:own.entry.id},exec)).entry.id,own.entry.id)
 await assert.rejects(write.execute({scope:'engineering',action:'upsert',key:'x',title:'x',content:'推断',expected_revision:1,user_quote:''},exec),/用户原话/)
 assert.equal((await f.project()).schema_version,2);assert.equal(Object.hasOwn(await f.project(),'memory'),false,'正式项目产物不混入另一套内容权威')
})

test('记忆并发冲突、同主题更新、归档恢复、删除及历史清除',async t=>{
 const f=await fixture(t),a=await remember(f,'project','tone','旧决定'),base={action:'upsert',id:a.entry.id,key:'tone',title:'风格',kind:'decision',stages:[],expected_revision:a.revision,user_quote:'用户修改'}
 const results=await Promise.allSettled(['新决定甲','新决定乙'].map(content=>f.projects.memories.change('project',{...base,content},f.context)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'EDIT_CONFLICT')
 const updated=await remember(f,'project','tone','最终决定');assert.equal(updated.entry.id,a.entry.id)
 let result=await f.projects.memories.change('project',{action:'archive',id:a.entry.id,expected_revision:updated.revision,user_quote:'暂不适用'},f.context);assert.equal((await f.projects.memories.capture(f.context,'shot_design')).entries.length,0)
 result=await f.projects.memories.change('project',{action:'restore',id:a.entry.id,expected_revision:result.revision,user_quote:'继续使用'},f.context);const frozen=await f.projects.memories.capture(f.context,'shot_design');assert.equal(frozen.entries[0].content,'最终决定');assert.ok((await f.projects.memories.read('project',{history:true,id:a.entry.id},f.context)).total>=4)
 await f.projects.memories.change('project',{action:'delete',id:a.entry.id,expected_revision:result.revision,user_quote:'忘记此决定'},f.context);await assert.rejects(f.projects.memories.read('project',{id:a.entry.id},f.context),/不存在/);const history=await f.projects.memories.read('project',{history:true,id:a.entry.id},f.context);assert.equal(history.entries.length,1);assert.equal(history.entries[0].entry,null);assert.equal(frozen.entries[0].content,'最终决定','旧任务的输入事实不会被当前删除改写')
})

test('文本按索引读取冻结记忆；运行中更新不影响独立审核，新任务使用新版本',async t=>{
 let changed=false;const seen=[],f=await fixture(t,{script:'第一章\n张飞进入营帐。',author:async(body,ctx)=>{
  const catalog=JSON.parse(body.messages[1].content);seen.push({stage:catalog.stage,action:catalog.action,messages:body.messages,catalog});const calls=body.messages.flatMap(m=>m.tool_calls||[])
  if(catalog.memory_index.entries.length&&!calls.some(c=>c.function.name==='read_memory')){
   if(!changed){changed=true;const current=await ctx.projects.memories.read('project',{}, {sessionId:f.context.sessionId});await ctx.projects.memories.change('project',{action:'upsert',key:'tone',title:'风格',content:'新版：只在高潮爆发',kind:'decision',stages:[],expected_revision:current.revision,user_quote:'只在高潮爆发'},f.context)}
   return reply(catalog.memory_index.entries.map(e=>call('read_memory',{id:e.id})))
  }
  return defaultAuthor(body,ctx)
 }})
 await remember(f,'project','tone','旧版：整体沉稳');await f.run('source_analysis');const first=await f.run('adaptation_plan');assert.ok(first.tasks[0].metadata.memory_snapshot_ref)
 const reads=seen.filter(c=>c.stage==='adaptation_plan').flatMap(c=>c.messages.filter(m=>m.role==='tool').map(m=>m.content));assert.ok(reads.some(s=>s.includes('旧版：整体沉稳')));assert.ok(reads.every(s=>!s.includes('新版：只在高潮爆发')))
 for(const item of seen.filter(c=>c.action==='review'))assert.ok(!item.messages.some(m=>(m.tool_calls||[]).some(c=>c.function.name==='submit_candidate')))
 const initial=seen[0].catalog;assert.equal(Object.hasOwn(initial.memory_index.entries[0],'content'),false);await f.run('story_segments');assert.ok(seen.filter(c=>c.stage==='story_segments').some(c=>c.messages.some(m=>m.role==='tool'&&m.content.includes('新版：只在高潮爆发'))))
})

test('记忆变更后失败续接沿用原快照，分页检索不会把所有正文注入',async t=>{
 let fail=true;const f=await fixture(t,{script:'第一章\n张飞进入营帐。',author:async(body,ctx)=>{if(fail&&JSON.parse(body.messages[1].content).action==='review')throw new Error('审核中断');return defaultAuthor(body,ctx)}})
 await remember(f,'engineering','tone','旧偏好');await f.run('source_analysis');const start=await f.production.run('adaptation_plan',{}, {...f.context,requestId:randomUUID()}),failed=await f.production.wait(start.group_id);assert.equal(failed.status,'failed');const ref=failed.tasks[0].metadata.memory_snapshot_ref;await remember(f,'engineering','tone','新偏好');fail=false;const resumed=await f.run('adaptation_plan',{resume_of:start.group_id});assert.equal(resumed.tasks[0].metadata.memory_snapshot_ref,ref)
 const snapshot=JSON.parse((await f.projects.documents.readArtifact(f.context.projectId,ref)).toString());assert.equal(snapshot.entries[0].content,'旧偏好')
 for(let i=0;i<23;i++)await remember(f,'project','key'+i,'正文'+i,{stages:['shot_design']});const current=await f.projects.memories.capture(f.context,'shot_design'),page=searchMemory(current);assert.equal(page.entries.length,20);assert.equal(page.total,24);assert.equal(searchMemory(current,{query:'正文22'}).entries[0].key,'key22');assert.ok(!JSON.stringify(page).includes('正文22'));await assert.rejects(mediaMemory(f.projects,{node_type:'video_render',metadata:{project_id:f.context.projectId,memory_snapshot_ref:ref}}),/不属于当前任务/)
})

test('记忆harness-http验证会话、请求标识、冲突；工程偏好只接受preference',async t=>{
 const f=await fixture(t),url=`${f.api}/production-memory?session_id=${f.context.sessionId}&scope=engineering`,command={action:'upsert',key:'tone',title:'表达偏好',content:'克制',kind:'preference',stages:[],expected_revision:0,user_quote:'以后Drama项目都克制'}
 let res=await fetch(url,{method:'POST',body:JSON.stringify(command)});assert.equal(res.status,403);res=await fetch(url,{method:'POST',headers:{'x-drama-request':'1'},body:JSON.stringify(command)});assert.equal(res.status,200);res=await fetch(url,{method:'POST',headers:{'x-drama-request':'1'},body:JSON.stringify(command)});assert.equal(res.status,409)
 res=await fetch(url.replace('scope=engineering','scope=project').replace(f.context.sessionId,'unknown'));assert.equal(res.status,403);res=await fetch(url.replace(f.context.sessionId,'new-unbound-session'));assert.equal(res.status,200);res=await fetch(url+'&query=克制');assert.equal((await res.json()).total,1)
})

test('图片视频实际模型输入使用适用项目记忆，不混入被覆盖工程偏好或其他步骤记忆',async t=>{
 const f=await fixture(t,{script:'第一章\n张飞进入营帐。'});await remember(f,'engineering','visual','工程色调TOKEN_ENGINE',{stages:['asset_preparation']});await remember(f,'project','visual','本项目色调TOKEN_PROJECT',{stages:['asset_preparation']});await remember(f,'project','voice','稳定声线TOKEN_VOICE',{stages:['video_render']});await remember(f,'project','plan','只影响规划TOKEN_PLAN',{stages:['adaptation_plan']})
 for(const stage of ['source_analysis','adaptation_plan','story_segments','shot_design','asset_preparation'])await f.run(stage)
 const images=f.requests.filter(r=>r.path==='/images/generations');assert.ok(images.length);assert.ok(images.every(r=>r.body.prompt.includes('TOKEN_PROJECT')&&!r.body.prompt.includes('TOKEN_ENGINE')&&!r.body.prompt.includes('TOKEN_PLAN')))
 let p=await f.project();for(const key of ['scenes','character_looks'])for(const asset of p.asset_library[key])await f.edit({kind:'image_select',stage:'asset_preparation',target_id:asset.id,image_id:asset.image_ids[0]});p=await f.project();await f.edit({kind:'confirm_stage',stage:'asset_preparation',expected_revision:p.node_states.asset_preparation.product_revision})
 for(const stage of ['reference_binding','clip_arrangement','video_prompt','video_render'])await f.run(stage)
 const videos=f.requests.filter(r=>r.path==='/videos/generations');assert.ok(videos.every(r=>r.body.prompt.includes('TOKEN_VOICE')&&!r.body.prompt.includes('TOKEN_PROJECT')));p=await f.project();const snapshot=JSON.parse((await f.projects.documents.readArtifact(f.context.projectId,p.videos[0].input_snapshot_ref)).toString());assert.ok(snapshot.memory_snapshot_ref)
})
