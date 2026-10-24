import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { SceneExtractionService } from '../src/node_box/scene_extraction/service.js'
import { changedSceneFields, sceneReviewHistory } from '../src/node_box/scene_extraction/review_context.js'
import { validateSceneCandidate } from '../src/node_box/scene_extraction/state.js'
import { expireStoryDependents } from '../src/node_box/story_segments/state.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { ExtractScenesTool } from '../src/tools/extract_scenes_tool.js'
import { ChangeRulesTool } from '../src/tools/planning_tools.js'
import { panel } from '../src/node_box/scene_extraction/ui/panel/index.js'
import { history } from '../src/node_box/scene_extraction/ui/conversation/history.js'
import { conversation } from '../src/node_box/scene_extraction/ui/conversation/index.js'
import { planningContext } from '../src/session/planning_context.js'

const passed = { status:'passed', issues:[] }
const candidate = () => ({scenes:[{id:'station',name:'高寒车站',description:'当代寒区山地救援站',layout:'大厅北侧通向站台，西侧为装备间',materials:'灰砖、暗色钢梁和耐磨水泥地面',lighting:'南侧高窗自然光，顶部固定灯',entrances_and_routes:'南门进入大厅，北侧出口通站台，西门通装备间',fixed_landmarks:'北侧候车钟，西门旁装备柜'},{id:'platform',name:'山侧站台',description:'车站的固定室外站台',layout:'铁轨在东侧，西侧靠山墙',materials:'混凝土与旧钢轨',lighting:'室外天光，立柱灯具',entrances_and_routes:'南阶梯和大厅北出口连通',fixed_landmarks:'站牌与山墙拐角'}]})
const issue = status => ({status,issues:[{location:'scenes[0].layout',reason:'通路需核对',suggestion:'按大纲修正入口'}]})
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
  const scenes=new SceneExtractionService({projects,records,models}),handler=createProjectHttpHandler(projects,{authorize:()=>null,models,sceneExtraction:scenes})
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const created=await projects.create({name:'场景测试',original_script:'人物反复经过救援站和站台。'},{sessionId:'source',requestId:'create'})
  const context={sessionId:created.session_id,projectId:created.project_id,requestId:'scenes'},file=join(root,'projects',created.project_id,'project.json')
  const edit=change=>projects.writes.run(async()=>{const p=JSON.parse(await readFile(file,'utf8'));change(p);await writeFile(file,JSON.stringify(p))})
  await edit(p=>{p.story_segments.segments=[{id:'segment_1',body:'进入高寒救援站，经过大厅北口前往山侧站台，次日返回。'}]})
  t.after(async()=>{await handler.dispose();server.closeAllConnections();mock.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>mock.close(r))]);await rm(root,{recursive:true,force:true})})
  const run=async(requestId='scenes',options={})=>{const a=await scenes.extractScenes({instruction:'提取固定场景'}, {...context,requestId,...options});return scenes.waitScenes(a.group_id,context.sessionId)}
  return{root,file,projects,records,scenes,models,calls,context,edit,run,origin:`http://127.0.0.1:${server.address().port}`}
}

test('场景Tool完整生成审核并保存，实际输入仅大纲和当前场景，不启动生图或其他盒子',async t=>{
  const f=await fixture(t),tool=new ExtractScenesTool({sceneExtraction:f.scenes})
  const report=JSON.parse(await tool.execute({instruction:'提取固定场景'},{callId:'scene-tool',agent:{session:{id:f.context.sessionId}}}))
  assert.equal(report.status,'completed');assert.equal(report.saved,true);assert.equal(report.result_reference,'#/scene_extraction/scenes')
  const p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.deepEqual(p.scene_extraction.scenes,candidate().scenes);assert.equal(p.scene_extraction.node_state.status,'generated')
  assert.equal(p.scene_extraction.assets.length,2);assert.equal(p.scene_extraction.assets[0].image_generation.aspect_ratio,p.basic_info.aspect_ratio)
  assert.equal(p.scene_extraction.assets.every(row=>row.image_generation.address===''),true)
  assert.deepEqual(p.group_setting.groups,[]);assert.deepEqual(p.character_extraction.characters,[])
  assert.deepEqual(f.calls.map(row=>row.action),['generate','review']);assert.ok(f.calls.every(row=>row.path.endsWith('/chat/completions')))
  const input=JSON.parse(f.calls[0].body.messages.at(-1).content.split('# 本次资料\n')[1])
  assert.deepEqual(Object.keys(input).sort(),['current_scenes','instruction','output_language','story_outline']);assert.equal(input.story_outline.segments[0].id,'segment_1')
  const context=await planningContext(f.projects,f.records,{sessionId:f.context.sessionId})
  assert.ok(context.executable_boxes.includes('scene_extraction'));assert.deepEqual(context.scene_extraction.output.scenes,candidate().scenes)
  const states=await f.projects.nodeStates(f.context.sessionId);assert.equal(states.nodes.scene_extraction.last_execution.status,'completed');assert.equal(states.nodes.scene_extraction.last_execution.stop_code,'completed')
})

test('无大纲拒绝场景任务，重复ID/额外资产字段拒绝，不写无效候选',async t=>{
  const f=await fixture(t,()=>({scenes:[candidate().scenes[0],candidate().scenes[0]]}))
  await f.edit(p=>{p.story_segments.segments=[]});await assert.rejects(f.run(),/大纲/);assert.equal(f.calls.length,0)
  await f.edit(p=>{p.story_segments.segments=[{id:'segment_1',body:'救援站内'}]})
  const report=await f.run();assert.equal(report.status,'failed');assert.equal(report.saved,false)
  assert.deepEqual((await f.projects.snapshot(f.context.sessionId)).project.scene_extraction.scenes,[])
  assert.throws(()=>validateSceneCandidate({scenes:[],assets:[]}),/不允许额外字段/)
  assert.throws(()=>validateSceneCandidate({scenes:[{...candidate().scenes[0],layout:4}]}),/layout/)
})

test('场景内容问题自动修订复审，完整记录候选与审核轮次',async t=>{
  let reviews=0
  const f=await fixture(t,(_body,action)=>action==='review'?(reviews++===0?issue('content_issue'):passed):candidate())
  assert.equal((await f.run()).status,'completed');assert.deepEqual(f.calls.map(row=>row.action),['generate','review','revise','review'])
  assert.match(f.calls[2].body.messages.at(-1).content,/review_issues/)
})

test('终态未通过保留场景候选和停止原因，用户继续修改关联原任务',async t=>{
  let accept=false
  const f=await fixture(t,(_body,action)=>action==='review'?(accept?passed:issue('content_issue')):candidate());f.scenes.maxRevisionRounds=0
  const report=await f.run();assert.equal(report.status,'rejected');assert.equal(report.saved,true);assert.equal(report.requires_user_decision,true)
  const states=await f.projects.nodeStates(f.context.sessionId);assert.equal(states.nodes.scene_extraction.status,'rejected');assert.equal(states.nodes.scene_extraction.last_execution.stop_code,'content_issue')
  assert.match(states.nodes.scene_extraction.reason,/通路/)
  await assert.rejects(f.scenes.extractScenes({instruction:'提取固定场景',retry_of:report.group_id},{...f.context,requestId:'blind'}),/尚未变化/)
  accept=true
  const a=await f.scenes.extractScenes({instruction:'提取固定场景',retry_of:report.group_id},{...f.context,requestId:'continue',source:'ui',retryAction:'continue'})
  const result=await f.scenes.waitScenes(a.group_id,f.context.sessionId);assert.equal(result.status,'completed');assert.equal(result.parent_group_id,report.group_id)
  assert.deepEqual(f.records.tasks.detail(f.records.scope,a.group_id).steps.map(row=>row.kind),['revise','review'])
})

test('场景规则冲突经原生授权修复，规则和意见只修改本盒子',async t=>{
  const f=await fixture(t,(_body,action)=>action==='review'?issue('rule_conflict'):candidate()),report=await f.run()
  assert.equal(report.decision,'rule_conflict');assert.deepEqual(report.related_nodes,['scene_extraction'])
  const patch={action:'review',field:'supplement',previous_value:'',value:'按固定布局核对，不按机位拆场景'}
  await assert.rejects(f.scenes.changeRules(patch,{sessionId:f.context.sessionId,requestId:'rules',reportId:report.group_id}),/授权/)
  const tool=new ChangeRulesTool({projects:f.projects,records:f.records,sceneExtraction:f.scenes})
  const result=JSON.parse(await tool.execute({report_id:report.group_id,...patch},{callId:'rules',agent:{session:{id:f.context.sessionId},ctx:{approval:{request:async req=>{assert.match(req.reason,/场景提取/);return 'allowed-once'}}}}}))
  assert.equal(result.saved,true);assert.equal(result.node_type,'scene_rules');assert.ok(f.records.nodeTypes.some(row=>row.type==='scene_rules'))
  await f.projects.edit({kind:'node_opinion',node_type:'scene_extraction',value:'保留北出口',previousValue:''},f.context)
  await f.projects.edit({kind:'rules',node_type:'scene_extraction',action:'generate',field:'supplement',value:'保持通路',previousValue:''},f.context)
  const p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(p.scene_extraction.node_state.opinion,'保留北出口');assert.equal(p.scene_extraction.node_state.rules.review.supplement,patch.value)
  assert.equal(p.character_extraction.node_state.opinion,'');assert.equal(p.group_setting.node_state.rules.generate.supplement,'')
})

test('场景harness-http鉴权/归属/幂等/项目互斥，运行快照和完成重放正确',async t=>{
  let enter,release;const entered=new Promise(resolve=>{enter=resolve})
  const f=await fixture(t,async(_body,action)=>{if(action==='generate'){enter();await new Promise(resolve=>{release=resolve})}return action==='review'?passed:candidate()})
  const post=(data,marker=true)=>fetch(`${f.origin}/api/drama/scenes?session_id=${f.context.sessionId}`,{method:'POST',headers:{'Content-Type':'application/json',...(marker?{'X-Drama-Request':'1'}:{})},body:JSON.stringify(data)})
  assert.equal((await post({request_id:'bad',instruction:'提取'},false)).status,403)
  assert.equal((await post({project_id:'other',request_id:'bad',instruction:'提取'})).status,403)
  const args={project_id:f.context.projectId,request_id:'same',instruction:'提取固定场景'},a=await(await post(args)).json();await entered
  const snapshot=await(await fetch(`${f.origin}/api/drama/project?session_id=${f.context.sessionId}`)).json();assert.equal(snapshot.scene_execution.group_id,a.group_id);assert.equal(snapshot.scene_execution.status,'running')
  assert.equal((await(await post(args)).json()).group_id,a.group_id)
  await assert.rejects(f.scenes.extractScenes({instruction:'另一要求'},{...f.context,requestId:'busy'}),/已有.*任务/)
  await assert.rejects(f.scenes.waitScenes(a.group_id,'other'),{code:'PROJECT_SCOPE'})
  release();assert.equal((await f.scenes.waitScenes(a.group_id,f.context.sessionId)).status,'completed')
  assert.equal((await(await post(args)).json()).group_id,a.group_id);assert.equal(f.calls.length,2)
})

test('场景资产按ID保留，变化或恢复场景照片过期，无关照片和删除资产继续保留',async t=>{
  let output=candidate();const f=await fixture(t,(_body,action)=>action==='review'?passed:output);await f.run()
  await f.edit(p=>{for(const row of p.scene_extraction.assets){row.image_generation.address='/old-'+row.scene_id+'.png';row.image_generation.node_state.status='generated';row.image_generation.node_state.rules.generate.supplement='已保存图片规则';row.image_generation.reference_image='原参考'}for(const type of ['group_setting','character_extraction','shot_design','video_prompt'])p[type].node_state.status='generated'})
  const before=(await f.projects.snapshot(f.context.sessionId)).project.scene_extraction.assets
  await f.run('same');assert.deepEqual((await f.projects.snapshot(f.context.sessionId)).project.scene_extraction.assets,before)
  output.scenes[0].layout+='，东侧保留检票口';await f.run('changed')
  let p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(p.scene_extraction.assets[0].image_generation.node_state.status,'expired');assert.equal(p.scene_extraction.assets[0].image_generation.address,'/old-station.png')
  assert.equal(p.scene_extraction.assets[1].image_generation.node_state.status,'generated');assert.equal(p.scene_extraction.assets[0].image_generation.reference_image,'原参考')
  assert.equal(p.scene_extraction.assets[0].image_generation.node_state.rules.generate.supplement,'已保存图片规则')
  for(const type of ['group_setting','character_extraction','shot_design','video_prompt'])assert.equal(p[type].node_state.status,'expired')
  output={scenes:[output.scenes[0]]};await f.run('remove');p=(await f.projects.snapshot(f.context.sessionId)).project;assert.equal(p.scene_extraction.assets.length,2)
  output=candidate();await f.run('restore');p=(await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(p.scene_extraction.assets.find(row=>row.scene_id==='platform').image_generation.node_state.status,'expired')
})

test('执行中大纲变化拒绝迟到场景覆盖；请求失败保留最新已保存候选',async t=>{
  let f,mutate=false,fail=false
  f=await fixture(t,async(_body,action)=>{if(fail)return {__httpStatus:500};if(mutate&&action==='revise')await f.edit(p=>{p.story_segments.segments[0].body='大纲已改为港口'})
    return action==='review'?passed:candidate()})
  await f.run();const saved=(await f.projects.snapshot(f.context.sessionId)).project.scene_extraction.scenes
  mutate=true;const late=await f.run('late');assert.equal(late.status,'failed');assert.equal(late.saved,false)
  assert.deepEqual((await f.projects.snapshot(f.context.sessionId)).project.scene_extraction.scenes,saved)
  mutate=false;fail=true;const error=await f.run('request-failed');assert.equal(error.status,'failed');assert.equal(error.saved,false)
  assert.deepEqual((await f.projects.snapshot(f.context.sessionId)).project.scene_extraction.scenes,saved)
  const states=await f.projects.nodeStates(f.context.sessionId);assert.equal(states.nodes.scene_extraction.last_execution.stop_code,'request_failed')
})

test('空场景集合允许审核通过，故事大纲变化使场景、团队和人物过期',async t=>{
  const f=await fixture(t,(_body,action)=>action==='review'?passed:{scenes:[]});assert.equal((await f.run()).status,'completed')
  const p=(await f.projects.snapshot(f.context.sessionId)).project;assert.deepEqual(p.scene_extraction.scenes,[]);assert.equal(p.scene_extraction.node_state.status,'generated')
  p.group_setting.node_state.status=p.character_extraction.node_state.status='generated';expireStoryDependents(p)
  for(const type of ['scene_extraction','group_setting','character_extraction'])assert.equal(p[type].node_state.status,'expired')
})

test('场景面板独立loading、连点去重、资料安全展示，意见与历史规则入口正确',async t=>{
  const f=await fixture(t),p=(await f.projects.snapshot(f.context.sessionId)).project
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()})
  const root=document.querySelector('main'),state={},calls=[],opened=[];let release
  const scenes={isCurrent:()=>true,generate:async(...args)=>{calls.push(args);await new Promise(resolve=>{release=resolve});return{group_id:'scene',status:'queued'}},setExecution:value=>{scenes.execution=value}}
  const render=()=>{root.replaceChildren();panel.render(root,p,{state,scenes:{...scenes,repaint:render},openTasks:(...args)=>opened.push(args),openRules:(...args)=>opened.push(args)})}
  render();const controls=root.querySelectorAll('.node-ui-records button');controls[0].click();controls[1].click();assert.deepEqual(opened.map(row=>row[0]),['scene_extraction','scene_extraction'])
  const button=root.querySelector('.node-ui-execution button');button.click();button.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.match(root.querySelector('[aria-live]').textContent,/正在提交场景/)
  release();await new Promise(resolve=>setImmediate(resolve));assert.match(root.querySelector('[aria-live]').textContent,/排队中/)
  scenes.execution=null;p.scene_extraction.scenes=[{...candidate().scenes[0],description:'<img src=x onerror=alert(1)>'}];render();assert.equal(root.querySelector('img'),null);assert.ok(root.textContent.includes('<img src=x'))
})

test('场景会话只从当次快照显示输入结果，审核失败保留部分结果且不透内部规则',()=>{
  const output=candidate(),task={task_status:'completed',metadata:{input_snapshot:{story_outline:{segments:[{id:'segment_1',body:'当次剧情'}]},current_scenes:output,instruction:'保留通路',output_language:'zh-CN',rules:{secret:'内部规则'}}}}
  const input=history.inputDependencies(task);assert.equal(input.rules,undefined)
  const steps=[{kind:'generate',seq:1,result:{output}},{kind:'review',seq:2,result:{review:passed}}];assert.deepEqual(history.taskOutput(task,steps).result,output)
  assert.deepEqual(history.taskOutput({...task,task_status:'rejected'},steps).partial_result.output,output)
  const dom=new JSDOM('<main/>'),body=dom.window.document.querySelector('main'),node=(tag,text)=>{const value=dom.window.document.createElement(tag);value.textContent=text;return value}
  conversation.renderInput(body,input,{node});assert.ok(body.textContent.includes('当次剧情'));assert.ok(body.textContent.includes(output.scenes[0].layout))
  body.replaceChildren();conversation.renderStepOutput(body,{output},{node});assert.ok(body.textContent.includes('场景提取'));assert.ok(body.textContent.includes('高寒车站'));dom.window.close()
})

test('场景审核期间取消保留已保存候选，停止原因可轮询且不继续修订',async t=>{
  let enter,release;const entered=new Promise(resolve=>{enter=resolve})
  const f=await fixture(t,async(_body,action)=>{if(action==='review'){enter();await new Promise(resolve=>{release=resolve})}return action==='review'?passed:candidate()})
  t.after(()=>release?.())
  const a=await f.scenes.extractScenes({instruction:'提取固定场景'},f.context);await entered
  f.records.tasks.cancel(f.records.scope,a.group_id,'用户停止场景提取');release()
  const report=await f.scenes.waitScenes(a.group_id,f.context.sessionId)
  assert.equal(report.status,'cancelled');assert.equal(report.saved,true)
  const p=(await f.projects.snapshot(f.context.sessionId)).project;assert.deepEqual(p.scene_extraction.scenes,candidate().scenes)
  const states=await f.projects.nodeStates(f.context.sessionId);assert.equal(states.nodes.scene_extraction.last_execution.stop_code,'cancelled')
  assert.match(states.nodes.scene_extraction.last_execution.message,/用户停止/);assert.equal(f.calls.length,2)
})

test('场景审核上游问题停止并指向大纲，不擅改剧情或执行其他盒子',async t=>{
  const f=await fixture(t,(_body,action)=>action==='review'?issue('upstream_issue'):candidate())
  const before=(await f.projects.snapshot(f.context.sessionId)).project.story_segments
  const report=await f.run();assert.equal(report.status,'rejected');assert.deepEqual(report.related_nodes,['story_segments'])
  const p=(await f.projects.snapshot(f.context.sessionId)).project;assert.deepEqual(p.story_segments,before)
  assert.deepEqual(f.calls.map(row=>row.action),['generate','review'])
})

test('审阅上下文记录各轮意见和真实字段变化，不复制旧全文或判定已解决，构建过程不修改记录',()=>{
  const original=candidate(),revised=structuredClone(original);revised.scenes[0].layout='新的相容布局';revised.scenes.pop();revised.scenes.push({...original.scenes[1],id:'new_scene'})
  const rows=[{kind:'generate',round:0,result:{output:original}},{kind:'review',round:0,result:{review:issue('content_issue')}},{kind:'revise',round:1,result:{output:revised}},{kind:'review',round:1,result:{review:issue('content_issue')}}]
  const before=structuredClone(rows),value=sceneReviewHistory(rows)
  assert.deepEqual(rows,before);assert.equal(value.length,2)
  assert.deepEqual(value[0].revision.changed_fields,[{scene_id:'station',change:'modified',fields:['layout']},{scene_id:'new_scene',change:'added',fields:Object.keys(original.scenes[1]).filter(key=>key!=='id')},{scene_id:'platform',change:'removed',fields:[]}])
  assert.equal(value[0].revision.applied,true);assert.equal(value[1].revision.applied,false)
  assert.equal(Object.hasOwn(value[0],'resolved'),false);assert.equal(JSON.stringify(value).includes(original.scenes[0].layout),false)
  value[0].issues[0].reason='不能污染历史';assert.equal(rows[1].result.review.issues[0].reason,'通路需核对')
  assert.deepEqual(changedSceneFields(original,structuredClone(original)),[])
})

test('场景修订和复审携带前轮意见及修改字段，复审仍可拒绝真实新问题',async t=>{
  let reviews=0,output=candidate()
  const f=await fixture(t,(body,action)=>{
    const input=JSON.parse(body.messages.at(-1).content.split('# 本次资料\n')[1])
    if(action==='generate'){assert.equal(input.review_history,undefined);return output}
    if(action==='revise'){
      assert.equal(input.review_history.at(-1).revision.applied,false)
      assert.equal(input.review_issues[0].location,'scenes[0].layout')
      output=structuredClone(output);output.scenes[0].layout='站台和大厅采用可通行的固定连接';return output
    }
    if(reviews++===0){assert.equal(input.review_history,undefined);return issue('content_issue')}
    assert.equal(input.review_history.length,1);assert.equal(input.review_history[0].revision.applied,true)
    assert.deepEqual(input.review_history[0].revision.changed_fields,[{scene_id:'station',change:'modified',fields:['layout']}])
    assert.match(body.messages[0].content,/不能仅凭“原文未写”拒绝/)
    assert.match(body.messages[0].content,/历史意见同样可能错误/)
    return {status:'content_issue',issues:[{location:'scenes[1].entrances_and_routes',reason:'新发现与定稿有冲突的必经通路',suggestion:'保留定稿明确的连接'}]}
  })
  f.scenes.maxRevisionRounds=1
  const report=await f.run();assert.equal(report.status,'rejected');assert.equal(report.saved,true)
  const detail=f.records.tasks.detail(f.records.scope,report.group_id),review=detail.steps.at(-1)
  assert.equal(review.prompt.input.review_history[0].revision.applied,true)
  assert.match(report.reason,/新发现/)
  assert.equal(history.inputDependencies(detail.tasks[0],review.prompt.input).review_history,undefined)
})

test('继续修改任务把原失败问题带入复审，辅助上下文以受理快照为基准',async t=>{
  let accept=false
  const f=await fixture(t,(body,action)=>{
    const input=JSON.parse(body.messages.at(-1).content.split('# 本次资料\n')[1])
    if(action==='review'&&accept){
      assert.equal(input.review_history[0].source,'retry');assert.equal(input.review_history[0].round,null)
      assert.equal(input.review_history[0].revision.applied,true);assert.deepEqual(input.review_history[0].revision.changed_fields,[])
      assert.equal(input.review_history[0].issues[0].reason,'通路需核对');return passed
    }
    if(action==='revise'&&accept){assert.equal(input.review_history[0].source,'retry');assert.equal(input.review_history[0].revision.applied,false)}
    return action==='review'?issue('content_issue'):candidate()
  })
  f.scenes.maxRevisionRounds=0
  const first=await f.run();accept=true
  const a=await f.scenes.extractScenes({instruction:'提取固定场景',retry_of:first.group_id},{...f.context,requestId:'with-history',source:'ui',retryAction:'continue'})
  assert.equal((await f.scenes.waitScenes(a.group_id,f.context.sessionId)).status,'completed')
})

test('面板HTTP重新生成从generate开始，普通修改仍revise，模式参与幂等校验且失败保留旧结果',async t=>{
  let fail=false
  const f=await fixture(t,(_body,action)=>fail?{__httpStatus:500}:action==='review'?passed:candidate())
  await f.run('initial')
  await f.run('revision')
  assert.equal(f.calls[2].action,'revise')
  const send=body=>fetch(`${f.origin}/api/drama/scenes?session_id=${f.context.sessionId}`,{method:'POST',headers:{'Content-Type':'application/json','X-Drama-Request':'1'},body:JSON.stringify({project_id:f.context.projectId,request_id:'regenerate-ui',instruction:'重新提取场景',...body})})
  const response=await send({regenerate:true});assert.equal(response.status,202)
  const started=await response.json();await f.scenes.waitScenes(started.group_id,f.context.sessionId)
  const detail=f.records.tasks.detail(f.records.scope,started.group_id)
  assert.equal(detail.tasks[0].metadata.regenerate,true)
  assert.deepEqual(detail.steps.map(row=>row.kind),['generate','review'])
  assert.equal((await send({regenerate:true})).status,202)
  assert.notEqual((await send({regenerate:false})).status,202)
  await assert.rejects(async()=>f.scenes.extractScenes({instruction:'重新提取',regenerate:'true'},f.context),/布尔/)
  const before=(await f.projects.snapshot(f.context.sessionId)).project.scene_extraction
  fail=true
  const failed=await f.scenes.extractScenes({instruction:'重新提取',regenerate:true},{...f.context,requestId:'regenerate-failed'})
  const report=await f.scenes.waitScenes(failed.group_id,f.context.sessionId)
  assert.equal(report.saved,false)
  const after=(await f.projects.snapshot(f.context.sessionId)).project.scene_extraction
  assert.deepEqual(after.scenes,before.scenes);assert.deepEqual(after.assets,before.assets)
})
