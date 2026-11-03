import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir,readFile,access} from 'node:fs/promises'
import {nodeBoxes,manualStage} from '../src/node_box/registry.js'
import {projectStages} from '../src/shared/production/production_stages.js'
import {TextProductionExecutor} from '../src/node_box/shared/production/text_executor.js'
import {readNodeRule,readNodeFormat} from '../src/shared/nodes/node_rule_files.js'
import {clientAssets} from '../src/harness_server/client_assets.js'
import {CreateProjectTool} from '../src/main_agent/tools/project/creat_project_tool.js'
import {fixture} from './helpers/production-fixture.js'

test('十二制作盒子与左侧阶段一一对应，辅助记忆独立；每类节点有实际业务入口',async()=>{
 const dirs=(await readdir(new URL('../src/node_box/',import.meta.url),{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name!=='shared').map(e=>e.name).sort()
 assert.deepEqual(dirs,projectStages.map(s=>s.id).sort());assert.deepEqual(Object.keys(nodeBoxes).sort(),dirs)
 for(const [id,box]of Object.entries(nodeBoxes)){
  assert.equal(box.id,id)
  const entries=await readdir(new URL(`../src/node_box/${id}/`,import.meta.url))
  assert.ok(entries.includes('runtime'),id);assert.ok(entries.every(name=>!name.endsWith('.js')),id)
  if(box.type==='text')for(const method of ['prepareText','applyCandidate','currentCandidate','writeCandidateFiles'])assert.equal(typeof box.pipeline[method],'function')
  else if(id!=='project'&&box.type==='program')assert.equal(typeof box.execute,'function')
  else await access(new URL(`../src/node_box/${id}/runtime/executor.js`,import.meta.url))
 }
 for(const action of ['generate','review','revise'])assert.match(await readNodeRule('memory_maintenance',action),/video_production|视频/)
 assert.ok((await readNodeFormat('memory_maintenance')).generate)
})

test('通用执行器不包含阶段产物分支，故事复核与素材/视频人工操作由盒子持有',async()=>{
 for(const file of ['text_executor','text_pipeline','program_executor']){
  const source=await readFile(new URL(`../src/node_box/shared/production/${file}.js`,import.meta.url),'utf8')
  assert.doesNotMatch(source,/story_audit|stage\s*===\s*['"]|node_type\s*===\s*['"]|planAssets|arrangeClips|buildTimeline/)
 }
 for(const kind of ['image_import','image_select','voice_extract'])assert.equal(manualStage({kind}),'asset_preparation')
 for(const kind of ['video_import','video_select','video_reject'])assert.equal(manualStage({kind}),'video_render')
 assert.equal(manualStage({kind:'audio_import',role:'track'}),'editing');assert.equal(manualStage({kind:'audio_import',role:'voice'}),'asset_preparation')
})

test('文本续接优先已保存候选和问题，不因节点默认生成为新生成；衔接复核仍从审核开始',()=>{
 const executor=new TextProductionExecutor({projects:{}}),unit={initial_action:'generate'}
 assert.equal(executor.nextStep(unit,{candidate_ref:'artifacts/candidate.json'}),'review')
 assert.equal(executor.nextStep(unit,{candidate_ref:'artifacts/candidate.json',issues:[{reason:'修订'}]}),'revise')
 assert.equal(executor.nextStep({initial_action:'review'}),'review');assert.equal(executor.nextStep(unit),'generate')
})

test('当前插件浏览器资源依赖闭合，只公开前端文件；退役路由不会进入旧盒子',async t=>{
 const f=await fixture(t),origin=new URL(f.api).origin
 for(const [name,file]of clientAssets){
  assert.doesNotMatch(name,/node_box\/production_|scene_extraction|costume_image|script_revision|node-registry|project-overview/)
  const res=await fetch(`${origin}/plugins/drama/src/${name}`);assert.equal(res.status,200,name)
  const source=await readFile(file,'utf8');if(!name.endsWith('.js'))continue
  for(const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){
   const target=new URL(match[2],`http://test/${name}`).pathname.slice(1);assert.ok(clientAssets.has(target),`${name} → ${target}`)
  }
 }
 for(const name of ['main_agent/tools/production_tools.js','node_box/shared/production/service.js','node_box/shared/agent/agent_tools.js','shared/nodes/node_rule_files.js','node_box/registry.js','node_box/asset_preparation/runtime/executor.js','project_runtime/project_document.js'])assert.equal((await fetch(`${origin}/plugins/drama/src/${name}`)).status,404)
 assert.equal((await fetch(`${f.api}/story-outline?session_id=${f.context.sessionId}`,{method:'POST'})).status,410)
 const response=await fetch(`${f.api}/node-rules?session_id=${f.context.sessionId}&node_type=adaptation_plan`),rules=await response.json();assert.equal(response.status,200);assert.match(rules.bases.generate,/改编/);assert.ok(rules.bases.output_format)
})

test('当前创建工具保留用户目标与宿主上下文，创建仍为纯程序且不清理其他短剧',async t=>{
 const f=await fixture(t),tool=new CreateProjectTool({projects:f.projects}),agent={session:{id:'source',snapshotEvents:()=>[{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'创建第二个短片短剧'}]}}]}}
 const created=JSON.parse(await tool.execute({name:'第二个短剧'},{agent,callId:'second-create'}))
 assert.notEqual(created.project_id,f.created.project_id);assert.equal((await f.project()).basic_info.name,'全流程测试')
 const detail=f.projects.records.tasks.detail(f.projects.records.scope,created.group_id);assert.deepEqual(detail.steps.map(s=>s.kind),['create']);assert.ok(detail.steps.every(s=>s.executor==='program'));assert.equal(f.requests.length,0)
 const again=JSON.parse(await tool.execute({name:'第二个短剧'},{agent,callId:'second-create'}));assert.equal(again.project_id,created.project_id)
})


test('主Agent、盒子与双方共用能力按职责归位，旧目录没有转发实现',async()=>{
 const root=new URL('../src/',import.meta.url)
 const entries=await readdir(new URL('shared/',root),{withFileTypes:true})
 assert.ok(entries.every(entry=>entry.isDirectory()))
 assert.deepEqual(entries.map(entry=>entry.name).sort(),['agent','media','nodes','production','text'])
 for(const old of ['production','node_runtime','tools','session'])await assert.rejects(access(new URL(old,root)),{code:'ENOENT'})
 const boxShared=await readdir(new URL('node_box/shared/',root))
 assert.deepEqual(boxShared.sort(),['agent','media','production'])
 const main=await readdir(new URL('main_agent/',root))
 assert.deepEqual(main.sort(),['session','settings','tools'])
 await assert.rejects(access(new URL('shared/tools/',root)),{code:'ENOENT'})
 await assert.rejects(access(new URL('node_box/project/tools/',root)),{code:'ENOENT'})
 await access(new URL('main_agent/tools/project/creat_project_tool.js',root))
 await access(new URL('main_agent/tools/project/fields.js',root))
})
