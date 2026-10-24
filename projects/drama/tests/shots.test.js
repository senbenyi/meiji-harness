import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { ShotDesignService } from '../src/node_box/shot_design/service.js'
import { changedShotFields, shotReviewHistory } from '../src/node_box/shot_design/review_context.js'
import { validateShotCandidate, parseShotCandidate } from '../src/node_box/shot_design/state.js'
import { expireStoryDependents } from '../src/node_box/story_segments/state.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { GenerateShotsTool } from '../src/tools/generate_shots_tool.js'
import { ChangeRulesTool } from '../src/tools/planning_tools.js'
import { panel } from '../src/node_box/shot_design/ui/panel/index.js'
import { history } from '../src/node_box/shot_design/ui/conversation/history.js'
import { conversation } from '../src/node_box/shot_design/ui/conversation/index.js'
import { createProjectView } from '../src/client/project-overview.js'
import { planningContext } from '../src/session/planning_context.js'

const passed = { status:'passed', issues:[] }
const candidate = () => ({shots:[{id:'shot_001',previous_shot_connection:'opening',story_segment_id:'segment_001',title:'进入站台',key_anchor_ids:['segment_001_anchor_001'],scene:{scene_id:'station',state:'白天天光',spatial_setup:'门在南侧'},groups:[{group_id:'rescue',costume_id:'uniform',presence:'两名工作人员',position:'门侧',facing:'北',gaze_target:'站台'}],characters:[{character_id:'lin',costume_id:'coat',name:'林',presence:'入画',position:'南门',facing:'北',gaze_target:'站台'}],beats:[{duration_seconds:4,action:'林推门进入，望向站台',camera:'中景平视，跟随推门',scene_changes:'',effects:'',audio:'开门声'}]}]})
const issue = status => ({status,issues:[{location:'shots[0].beats[0].action',reason:'缺少停顿',suggestion:'保留定稿中的回望'}]})
async function fixture(t, respond = (_body,action) => action==='review'?passed:candidate()) {
  const root=await mkdtemp(join(tmpdir(),'drama-scenes-')),calls=[]
  const mock=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const body=JSON.parse(Buffer.concat(chunks)),action=body.messages[0].content.match(/动作：(\w+)/)[1]
    calls.push({action,body,path:req.url})
    const value=await respond(body,action)
    if(value?.__httpStatus){res.writeHead(value.__httpStatus,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'模拟场景请求失败'}}));return}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}))
  })
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve))
  const projects=new ProjectService({root,workspaceController:{create:async()=>({workspace:{workspaceId:randomUUID()}}),rename:async()=>{}},sessionController:{create:async req=>({sessionId:req.sessionId})}})
  const records=createRecordService(root),models={read:async()=>({baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,text:{model:'scene-test'},output_language:'zh-CN'})}
  const scenes=new ShotDesignService({projects,records,models}),handler=createProjectHttpHandler(projects,{authorize:()=>null,models,shotDesign:scenes})
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const created=await projects.create({name:'场景测试',original_script:'人物反复经过救援站和站台。'},{sessionId:'source',requestId:'create'})
  const context={sessionId:created.session_id,projectId:created.project_id,requestId:'scenes'},file=join(root,'projects',created.project_id,'project.json')
  const edit=change=>projects.writes.run(async()=>{const p=JSON.parse(await readFile(file,'utf8'));change(p);await writeFile(file,JSON.stringify(p))})
  await edit(p=>{
    p.story_segments.segments=[{id:'segment_001',title:'车站',body:'林推门走进站台，回望门外。',key_anchors:[{id:'segment_001_anchor_001',content:'推门',expression:'林推门'}]}]
    p.story_segments.node_state.status='generated'
    p.scene_extraction.scenes=[{id:'station',name:'高寒车站'}];p.scene_extraction.node_state.status='generated'
    p.group_setting.groups=[{id:'rescue',name:'救援队',costumes:[{id:'uniform',story_segment_ids:['segment_001']}]}];p.group_setting.node_state.status='generated'
    p.character_extraction.characters=[{id:'lin',name:'林',costumes:[{id:'coat',story_segment_ids:['segment_001']}]}];p.character_extraction.node_state.status='generated'
  })
  t.after(async()=>{await handler.dispose();server.closeAllConnections();mock.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>mock.close(r))]);await rm(root,{recursive:true,force:true})})
  const run=async(requestId='scenes',options={})=>{const a=await scenes.generateShots({instruction:'完整设计分镜，保留回望'}, {...context,requestId,...options});return scenes.waitShots(a.group_id,context.sessionId)}
  return{root,file,projects,records,scenes,models,calls,context,edit,run,origin:`http://127.0.0.1:${server.address().port}`}
}


test('分镜Tool读取定稿及资产，完整生成审核保存，报告和历史与节点终态一致',async t=>{
  const f=await fixture(t),tool=new GenerateShotsTool({shotDesign:f.scenes})
  const report=JSON.parse(await tool.execute({instruction:'保留回望，镜头紧凑'},{callId:'tool',agent:{session:{id:f.context.sessionId}}}))
  assert.equal(report.status,'completed');assert.equal(report.saved,true);assert.equal(report.result_reference,'#/shot_design/shots')
  const p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(p.shot_design.shots,candidate().shots);assert.equal(p.shot_design.node_state.status,'generated')
  const input=JSON.parse(f.calls[0].body.messages.at(-1).content.split('# 本次资料\n')[1])
  assert.deepEqual(Object.keys(input).sort(),['character_extraction','current_shots','group_setting','instruction','output_language','scene_extraction','story_outline'])
  assert.equal(input.instruction,'保留回望，镜头紧凑');assert.equal(input.character_extraction.characters[0].id,'lin');assert.ok(!JSON.stringify(input).includes('actual_script'))
  assert.deepEqual(f.calls.map(row=>row.action),['generate','review'])
  const context=await planningContext(f.projects,f.records,{sessionId:f.context.sessionId});assert.ok(context.executable_boxes.includes('shot_design'));assert.deepEqual(context.shot_design.output,candidate())
  const states=await f.projects.nodeStates(f.context.sessionId);assert.equal(states.nodes.shot_design.last_execution.stop_code,'completed')
  const detail=f.records.tasks.detail(f.records.scope,report.group_id),task=detail.tasks[0]
  assert.deepEqual(history.taskOutput(task,detail.steps).result,candidate());assert.ok(!Object.hasOwn(history.inputDependencies(task),'rules'))
})

test('分镜前置只要求确认大纲；非空资产需确认，空资产允许文字镜头且不启动其他盒子',async t=>{
  const f=await fixture(t)
  await f.edit(p=>{p.story_segments.node_state.status='expired'})
  await assert.rejects(f.run(),/确认故事大纲/)
  await f.edit(p=>{p.story_segments.node_state.status='generated';p.scene_extraction.node_state.status='expired'})
  await assert.rejects(f.run(),/scene_extraction/)
  await f.edit(p=>{p.scene_extraction.scenes=[];p.group_setting.groups=[];p.character_extraction.characters=[]})
  const output=candidate();output.shots[0].scene.scene_id='';output.shots[0].groups=[];output.shots[0].characters[0].character_id='';output.shots[0].characters[0].costume_id=''
  // 没有资产的镜头输入仍合法；不强制照片或补建群众团队。
  const p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(validateShotCandidate(output,{story_outline:p.story_segments,scene_extraction:p.scene_extraction,group_setting:p.group_setting,character_extraction:p.character_extraction}),output)
  assert.equal(f.calls.length,0)
})

test('分镜程序校验覆盖故事段、锚点归属/覆盖、顺序、资产/服装、开场和节拍',async t=>{
  const f=await fixture(t),p=(await f.projects.snapshot(f.context.sessionId)).project,scope={story_outline:p.story_segments,scene_extraction:p.scene_extraction,group_setting:p.group_setting,character_extraction:p.character_extraction}
  const invalid=(change,pattern)=>{const value=candidate();change(value);assert.throws(()=>validateShotCandidate(value,scope),pattern)}
  assert.throws(()=>validateShotCandidate({shots:[]}),/不能为空/)
  invalid(v=>v.shots.push(structuredClone(v.shots[0])),/ID重复/)
  invalid(v=>v.shots[0].story_segment_id='unknown',/故事段/)
  invalid(v=>v.shots[0].key_anchor_ids=['other'],/锚点不属于/)
  invalid(v=>v.shots[0].key_anchor_ids=[],/遗漏关键锚点/)
  invalid(v=>v.shots[0].scene.scene_id='other',/场景引用/)
  invalid(v=>v.shots[0].characters[0].costume_id='uniform',/人物服装/)
  invalid(v=>v.shots[0].groups[0].costume_id='coat',/团队服装/)
  invalid(v=>v.shots[0].characters[0].character_id='other',/人物引用/)
  invalid(v=>v.shots[0].groups[0].group_id='other',/团队引用/)
  invalid(v=>v.shots[0].previous_shot_connection='cut',/第一镜/)
  invalid(v=>v.shots[0].beats[0].duration_seconds=0,/大于/)
  invalid(v=>v.shots[0].beats[0].camera='',/首拍/)
  const inherited=candidate();inherited.shots[0].beats.push({...inherited.shots[0].beats[0],camera:'',audio:''});assert.doesNotThrow(()=>validateShotCandidate(inherited,scope))
  scope.character_extraction.characters[0].costumes[0].story_segment_ids=['other'];assert.doesNotThrow(()=>validateShotCandidate(candidate(),scope))
})

test('分镜内容问题自动修订且每次有效候选保存；上游问题立即停止并保留结果',async t=>{
  let reviews=0;const output=candidate(),f=await fixture(t,(_body,action)=>action==='review'?(++reviews===1?issue('content_issue'):passed):output)
  const report=await f.run();assert.equal(report.status,'completed');assert.deepEqual(f.calls.map(row=>row.action),['generate','review','revise','review'])
  const revise=JSON.parse(f.calls[2].body.messages.at(-1).content.split('# 本次资料\n')[1]);assert.equal(revise.review_issues[0].reason,'缺少停顿');assert.equal(revise.review_history.length,1)
  const g=await fixture(t,(_body,action)=>action==='review'?issue('upstream_issue'):candidate()),stopped=await g.run()
  assert.equal(stopped.status,'rejected');assert.equal(stopped.decision,'upstream_issue');assert.equal(stopped.saved,true);assert.ok(stopped.related_nodes.includes('story_segments'));assert.equal(g.calls.length,2)
  const p=(await g.projects.snapshot(g.context.sessionId)).project;assert.deepEqual(p.shot_design.shots,candidate().shots);assert.equal(p.shot_design.node_state.last_execution.stop_code,'upstream_issue')
})

test('分镜达到修订上限后停止，用户继续/重新生成沿用明确决策；非法候选不覆盖',async t=>{
  let fail=true,rev=0;const f=await fixture(t,(_body,action)=>action==='review'?(fail?{status:'content_issue',issues:[{location:'shots[0]',reason:'问题'+(++rev),suggestion:'修正'}]}:passed):candidate())
  f.scenes.maxRevisionRounds=1
  const r=await f.run();assert.equal(r.status,'rejected');assert.equal(r.requires_user_decision,true);assert.equal(f.calls.length,4)
  await assert.rejects(f.scenes.generateShots({instruction:'继续',retry_of:r.group_id},{...f.context,requestId:'bad',retryAction:'continue'}),/用户选择/)
  fail=false
  const a=await f.scenes.generateShots({instruction:'继续',retry_of:r.group_id},{...f.context,source:'ui',requestId:'continue',retryAction:'continue'})
  assert.equal((await f.scenes.waitShots(a.group_id,f.context.sessionId)).status,'completed')
  const g=await fixture(t,()=>({shots:[{...candidate().shots[0],id:''}]})),before=(await g.projects.snapshot(g.context.sessionId)).project.shot_design.shots
  assert.equal((await g.run()).status,'failed');assert.deepEqual((await g.projects.snapshot(g.context.sessionId)).project.shot_design.shots,before)
})

test('分镜harness-http鉴权标识、scope、幂等和互斥，晚到候选不覆盖变化的上游',async t=>{
  let release;const held=new Promise(r=>release=r),f=await fixture(t,async(_body,action)=>{if(action==='generate')await held;return action==='review'?passed:candidate()})
  const post=(body,header=true,session=f.context.sessionId)=>fetch(`${f.origin}/api/drama/shots?session_id=${session}`,{method:'POST',headers:{'Content-Type':'application/json',...(header?{'X-Drama-Request':'1'}:{})},body:JSON.stringify(body)})
  const args={project_id:f.context.projectId,request_id:'http',instruction:'突出动作'}
  assert.equal((await post(args,false)).status,403);assert.notEqual((await post(args,true,'other')).status,202)
  const response=await post(args);assert.equal(response.status,202);const a=await response.json();assert.equal((await(await post(args)).json()).group_id,a.group_id)
  await assert.rejects(f.scenes.generateShots({instruction:'另一个'},{...f.context,requestId:'busy'}),/已有/)
  await assert.rejects(f.scenes.waitShots(a.group_id,'other'),/当前会话/)
  const snapshot=await(await fetch(`${f.origin}/api/drama/project?session_id=${f.context.sessionId}`)).json();assert.equal(snapshot.shot_execution.group_id,a.group_id)
  await f.edit(p=>{p.story_segments.segments[0].body+='后来离开。'});release()
  const report=await f.scenes.waitShots(a.group_id,f.context.sessionId);assert.equal(report.status,'failed');assert.equal(report.saved,false)
  assert.deepEqual((await f.projects.snapshot(f.context.sessionId)).project.shot_design.shots,[])
  assert.equal((await fetch(`${f.origin}/plugins/drama/src/node_box/shot_design/ui/conversation/history.js`)).status,200)
  assert.equal((await fetch(`${f.origin}/plugins/drama/src/node_box/shot_design/service.js`)).status,404)
})

test('分镜修改和重新生成动作明确，意见传入模型，下游过期而原资料/图片保留',async t=>{
  const f=await fixture(t);await f.run()
  await f.edit(p=>{p.clip_arrangement.node_state.status='generated';p.video_prompt.node_state.status='generated';p.shot_design.node_state.opinion='提高表演张力'})
  const a=await f.scenes.generateShots({instruction:'提高表演张力',regenerate:true},{...f.context,requestId:'regen'});await f.scenes.waitShots(a.group_id,f.context.sessionId)
  assert.equal(f.records.tasks.detail(f.records.scope,a.group_id).tasks[0].action,'generate')
  assert.ok(f.calls[2].body.messages.at(-1).content.includes('提高表演张力'))
  const old=(await f.projects.snapshot(f.context.sessionId)).project
  await f.projects.edit({kind:'rules',node_type:'shot_design',action:'generate',field:'supplement',value:'更明确摄影角度',previousValue:''},{...f.context})
  const p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(p.shot_design.node_state.status,'expired');assert.equal(p.clip_arrangement.node_state.status,'expired');assert.equal(p.video_prompt.node_state.status,'expired');assert.deepEqual(p.scene_extraction,old.scene_extraction)
})

test('分镜规则冲突须授权且校验旧值，修改后不自动重跑',async t=>{
  const f=await fixture(t,(_body,action)=>action==='review'?issue('rule_conflict'):candidate()),r=await f.run()
  const p=(await f.projects.snapshot(f.context.sessionId)).project,patch={action:'generate',field:'supplement',previous_value:p.shot_design.node_state.rules.generate.supplement,value:'镜头承接自然'}
  await assert.rejects(f.scenes.changeRules(patch,{sessionId:f.context.sessionId,requestId:'rules',reportId:r.group_id}),/授权/)
  const tool=new ChangeRulesTool({projects:f.projects,records:f.records,shotDesign:f.scenes}),result=JSON.parse(await tool.execute({report_id:r.group_id,...patch},{callId:'rules',agent:{session:{id:f.context.sessionId},ctx:{approval:{request:async()=> 'allowed-once'}}}}))
  assert.equal(result.status,'completed');assert.equal(f.calls.length,2);assert.equal((await f.projects.snapshot(f.context.sessionId)).project.shot_design.node_state.status,'expired')
})

test('分镜面板三入口保留意见、连点去重、展示完整节拍；会话输入含资产且无内部规则',async t=>{
  const f=await fixture(t),p=(await f.projects.snapshot(f.context.sessionId)).project
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');globalThis.document=dom.window.document;t.after(()=>{delete globalThis.document;dom.window.close()})
  const state={},calls=[];let pending,execution=null
  const operation={isCurrent:()=>true,repaint:()=>render(),generate:(...args)=>{calls.push(args);return new Promise(r=>pending=r)},setExecution:v=>execution=v}
  const render=()=>{root.replaceChildren();panel.render(root,p,{state,shots:{...operation,execution}})}
  render();let input=root.querySelector('input');input.value='充分表现紧张';input.dispatchEvent(new dom.window.Event('input'))
  root.querySelector('.node-ui-execution button').click();await new Promise(r=>setImmediate(r));assert.equal(calls[0][0],'充分表现紧张');pending({group_id:'g',status:'queued'});await new Promise(r=>setImmediate(r));assert.match(root.querySelector('[aria-live]').textContent,/排队中/)
  execution=null;p.shot_design.shots=candidate().shots;render();const regenerate=[...root.querySelectorAll('.node-ui-execution button')].find(b=>b.textContent==='重新生成');regenerate.click();regenerate.click();await new Promise(r=>setImmediate(r))
  assert.equal(calls.length,2);assert.match(calls[1][0],/本次要求：充分表现紧张/);assert.deepEqual(calls[1][2],{regenerate:true});pending({group_id:'regen',status:'queued'});await new Promise(r=>setImmediate(r))
  execution=null;render();const modify=[...root.querySelectorAll('.node-ui-execution button')].find(b=>b.textContent==='按意见修改');modify.click();await new Promise(r=>setImmediate(r));assert.equal(calls[2][0],'充分表现紧张');assert.equal(calls[2][2],undefined);pending({group_id:'mod',status:'queued'});await new Promise(r=>setImmediate(r))
  assert.match(root.textContent,/节拍 1/);assert.match(root.textContent,/推门/)
  const body=dom.window.document.createElement('div'),node=(tag,text)=>{const n=dom.window.document.createElement(tag);n.textContent=text;return n}
  conversation.renderInput(body,{story_outline:p.story_segments,scene_extraction:p.scene_extraction,group_setting:p.group_setting,character_extraction:p.character_extraction,instruction:'突出细节'},{node})
  assert.match(body.textContent,/场景资料/);assert.match(body.textContent,/人物资料/);assert.match(body.textContent,/突出细节/)
})


test('分镜审核网络失败仍保留候选及停止原因，取消后不写入迟到生成',async t=>{
  const f=await fixture(t,(_body,action)=>action==='review'?{__httpStatus:500}:candidate()),r=await f.run()
  assert.equal(r.status,'failed');assert.equal(r.saved,true);assert.equal(r.requires_user_decision,true)
  const p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(p.shot_design.shots,candidate().shots);assert.equal(p.shot_design.node_state.last_execution.stop_code,'request_failed');assert.equal(p.shot_design.node_state.status,'rejected')
  let release;const held=new Promise(resolve=>release=resolve),g=await fixture(t,async()=>{await held;return candidate()})
  const a=await g.scenes.generateShots({instruction:'生成分镜'},{...g.context,requestId:'cancel'})
  g.records.tasks.cancel(g.records.scope,a.group_id,'用户停止');release()
  const cancelled=await g.scenes.waitShots(a.group_id,g.context.sessionId);assert.equal(cancelled.status,'cancelled')
  await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual((await g.projects.snapshot(g.context.sessionId)).project.shot_design.shots,[])
})

test('项目视图分镜回调及轮询可达，其他任务阻止点击，销毁后迟到响应不回写',async t=>{
  const f=await fixture(t),p=(await f.projects.snapshot(f.context.sessionId)).project
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');globalThis.document=dom.window.document;t.after(()=>{delete globalThis.document;dom.window.close()})
  let resolve,calls=0;const state={mode:'production',productionTab:'shot_design'}
  const view=createProjectView(root,{project:p,state,generateShots:async(instruction)=>{calls++;assert.match(instruction,/连续节拍/);return new Promise(r=>resolve=r)}})
  const button=()=>root.querySelector('[data-node-type=shot_design] .node-ui-execution button')
  assert.equal(button().disabled,false)
  view.update(p,{sceneExecution:{group_id:'scene',status:'running'}});assert.equal(button().disabled,true)
  view.update(p,{sceneExecution:null});button().click();await new Promise(r=>setImmediate(r));assert.equal(calls,1)
  view.update(p,{shotExecution:{group_id:'shot',status:'running',step:{kind:'generate'}}})
  assert.match(root.querySelector('[data-node-type=shot_design] [aria-live]').textContent,/生成分镜/)
  view.dispose();const html=root.innerHTML;resolve({group_id:'late',status:'queued'});await new Promise(r=>setImmediate(r));assert.equal(root.innerHTML,html)
})

test('人物未写服装沿用唯一既有定妆服装，跨段不增套装；多套承接前镜而非目录首项',async t=>{
  const f=await fixture(t),p=(await f.projects.snapshot(f.context.sessionId)).project
  const scope={story_outline:p.story_segments,scene_extraction:p.scene_extraction,group_setting:p.group_setting,character_extraction:structuredClone(p.character_extraction)}
  const person=scope.character_extraction.characters[0]
  person.costumes[0].story_segment_ids=['other_segment']
  const value=candidate();value.shots[0].characters[0].costume_id=''
  assert.equal(validateShotCandidate(value,scope).shots[0].characters[0].costume_id,'coat')
  assert.equal(value.shots[0].characters[0].costume_id,'')
  person.costumes.unshift({id:'other_coat',story_segment_ids:['segment_001']})
  assert.throws(()=>validateShotCandidate(value,scope),/shot_001.*林.*多套服装/)
  scope.character_extraction.costume_references=[{character_id:'lin',costume_id:'coat'}]
  assert.equal(validateShotCandidate(value,scope).shots[0].characters[0].costume_id,'coat')
  const next=structuredClone(value.shots[0]);next.id='shot_002';next.previous_shot_connection='continuous'
  value.shots[0].characters[0].costume_id='other_coat';value.shots.push(next)
  const output=validateShotCandidate(value,scope)
  assert.equal(output.shots[1].characters[0].costume_id,'other_coat')
  next.characters[0].costume_id='invalid';assert.throws(()=>validateShotCandidate(value,scope),/人物服装引用无效/)
})

test('分镜模型收到实际定妆服装关联，空服装输出自动落实有效ID并完成审核保存',async t=>{
  const output=candidate();output.shots[0].characters[0].costume_id=''
  const f=await fixture(t,(_body,action)=>action==='review'?passed:output)
  await f.edit(p=>{p.character_extraction.assets=[{character_id:'lin',reference_image:'',costume_images:[{costume_id:'coat',address:'/existing.png',node_state:{status:'generated'}}]}];p.character_extraction.characters[0].costumes[0].story_segment_ids=['other_segment']})
  const report=await f.run();assert.equal(report.status,'completed')
  const input=JSON.parse(f.calls[0].body.messages.at(-1).content.split('# 本次资料\n')[1])
  assert.deepEqual(input.character_extraction.costume_references,[{character_id:'lin',costume_id:'coat'}])
  const p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(p.shot_design.shots[0].characters[0].costume_id,'coat');assert.equal(p.character_extraction.assets[0].costume_images[0].address,'/existing.png')
})


test('分镜仅清理全空团队占位；有内容缺ID、未知字段和缺字段仍严格拒绝',async t=>{
  const f=await fixture(t),p=(await f.projects.snapshot(f.context.sessionId)).project
  const scope={story_outline:p.story_segments,scene_extraction:p.scene_extraction,group_setting:{groups:[]},character_extraction:p.character_extraction}
  const value=candidate(),empty=Object.fromEntries(['group_id','costume_id','presence','position','facing','gaze_target'].map(key=>[key,'']))
  value.shots[0].groups=[empty]
  assert.deepEqual(parseShotCandidate(JSON.stringify(value),scope).shots[0].groups,[])
  assert.deepEqual(value.shots[0].groups,[empty])
  value.shots[0].groups=[{...empty,presence:'观众'}];assert.throws(()=>parseShotCandidate(JSON.stringify(value),scope),/group_id/)
  value.shots[0].groups=[{...empty,extra:''}];assert.throws(()=>parseShotCandidate(JSON.stringify(value),scope),/额外字段/)
  value.shots[0].groups=[{group_id:''}];assert.throws(()=>parseShotCandidate(JSON.stringify(value),scope),/缺少必填字段/)
  value.shots[0].groups=[{...empty,group_id:'unknown'}];assert.throws(()=>parseShotCandidate(JSON.stringify(value),scope),/团队引用不存在/)
})

test('模型输出空团队占位不再使完整分镜失败，审核和保存使用空数组',async t=>{
  const output=candidate();output.shots[0].groups=[{group_id:'',costume_id:'',presence:'',position:'',facing:'',gaze_target:''}]
  const f=await fixture(t,(_body,action)=>action==='review'?passed:output)
  await f.edit(p=>{p.group_setting.groups=[]})
  const report=await f.run();assert.equal(report.status,'completed')
  assert.deepEqual((await f.projects.snapshot(f.context.sessionId)).project.shot_design.shots[0].groups,[])
  const reviewInput=JSON.parse(f.calls[1].body.messages.at(-1).content.split('# 本次资料\n')[1]);assert.deepEqual(reviewInput.current_shots.shots[0].groups,[])
})
