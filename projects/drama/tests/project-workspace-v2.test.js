import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {ProjectWorkspaceService} from '../src/project_runtime/project_workspace_service.js'
import {boxReport} from '../src/node_runtime/box_report.js'
import {createRecordService} from '../src/records/service.js'
import {createProjectHttpHandler} from '../src/harness_server/project_routes.js'
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'drama-workspace-v2-')),records=createRecordService(root),workspaces=[]
 const projects=new ProjectWorkspaceService({root,records,workspaceController:{async create({path}){const workspace={workspaceId:randomUUID(),path};workspaces.push(workspace);return {workspace}},async rename(){}},sessionController:{async create({sessionId,workspaceId}){const w=workspaces.find(w=>w.workspaceId===workspaceId);if(w)(w.sessionIds||=[]).push(sessionId);return {sessionId}}},workspaceForSession:id=>{const row=workspaces.find(w=>w.sessionIds?.includes(id));return row&&{id:row.workspaceId,path:row.path}}})
 t.after(async()=>{await projects.dispose();await rm(root,{recursive:true,force:true})})
 return {root,projects,records,workspaces}
}
async function created(f){const c=await f.projects.create({name:'新流程',original_script:'原稿'}, {sessionId:'source',requestId:'create-1'});return {c,context:{sessionId:c.session_id,projectId:c.project_id}}}
test('新入口纯程序创建V2并保持幂等、项目归属与外置原稿',async t=>{
 const f=await fixture(t),{c,context}=await created(f),p=(await f.projects.snapshot(c.session_id)).project
 assert.equal(p.schema_version,2);assert.equal(f.records.http.list().length,0);assert.equal((await f.projects.readOriginalScript(c.session_id)).body,'原稿')
 assert.equal((await f.projects.create({name:'新流程',original_script:'原稿'},{sessionId:'source',requestId:'create-1'})).project_id,c.project_id)
 assert.equal(f.workspaces.length,1);await assert.rejects(f.projects.context('source',c.project_id),{code:'PROJECT_SCOPE'})
 assert.equal((await f.projects.context(context.sessionId,context.projectId)).basic_info.id,c.project_id)
 const task=f.records.tasks.detail(f.records.scope,c.group_id);assert.deepEqual(task.steps.map(s=>s.executor),['program']);assert.equal(task.tasks[0].metadata.document_version,2);assert.equal(boxReport(task).session_id,c.session_id)
})
test('人工编辑走Task，冲突保留旧产物，重试不重复写入',async t=>{
 const f=await fixture(t),{c,context}=await created(f),p=(await f.projects.snapshot(c.session_id)).project,command={kind:'product',stage:'adaptation_plan',expected_revision:0,value:{...p.adaptation_plan,goal:'尊重原著'}}
 const result=await f.projects.edit(command,{...context,requestId:'manual-1'});assert.equal(result.project.adaptation_plan.goal,'尊重原著');assert.equal(result.project.node_states.adaptation_plan.status,'draft')
 const repeated=await f.projects.edit(command,{...context,requestId:'manual-1'});assert.equal(repeated.project.document_revision,result.project.document_revision)
 await assert.rejects(f.projects.edit({...command,value:{...command.value,goal:'覆盖'}},{...context,requestId:'manual-1'}),/不同编辑内容/)
 await assert.rejects(f.projects.edit(command,{...context,requestId:'manual-2'}),/已被修改/)
 assert.equal((await f.projects.snapshot(c.session_id)).project.adaptation_plan.goal,'尊重原著')
 const task=f.records.tasks.detail(f.records.scope,result.group_id);assert.equal(task.steps[0].result.saved,true);assert.equal(task.steps[0].result.payload_ref,task.tasks[0].metadata.payload_ref)
})
test('正文编辑创建不可变文件版本，不改其他阶段或原始文件',async t=>{
 const f=await fixture(t),{c,context}=await created(f),p=(await f.projects.snapshot(c.session_id)).project
 const ref=await f.projects.documents.writeArtifact(c.project_id,'旧预览说明');await f.projects.edit({kind:'product',stage:'editing',expected_revision:0,value:{...p.editing,preview_ref:ref}},context)
 const result=await f.projects.edit({kind:'artifact_text',stage:'editing',ref,value:'新预览说明',expected_revision:1},context)
 assert.notEqual(result.project.editing.preview_ref,ref);assert.equal((await f.projects.documents.readArtifact(c.project_id,ref)).toString(),'旧预览说明')
 assert.equal((await f.projects.documents.readArtifact(c.project_id,result.project.editing.preview_ref)).toString(),'新预览说明')
 await assert.rejects(f.projects.edit({kind:'artifact_text',stage:'story_segments',ref,value:'错误跨阶段',expected_revision:0},context),/不属于/)
})
test('V2项目HTTP支持创建/人工编辑/分页正文并拒绝旧AI端点',async t=>{
 const f=await fixture(t),handler=createProjectHttpHandler(f.projects,{authorize:()=>null,models:{read:async()=>({}),save:async x=>x}}),server=createServer(handler)
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await handler.dispose();await new Promise(r=>server.close(r))})
 const base=`http://127.0.0.1:${server.address().port}/api/drama`,send=(path,value,method='POST')=>fetch(base+path,{method,headers:{'x-drama-request':'1','content-type':'application/json'},body:JSON.stringify(value)})
 const response=await send('/projects?session_id=source',{fields:{basic_info:{name:'接口项目',original_script:'x'.repeat(3*1024*1024)}},request_id:'http-create'});assert.equal(response.status,200)
 const c=await response.json(),query=`?session_id=${c.session_id}`,snapshot=await (await fetch(base+'/project'+query)).json();assert.equal(snapshot.project.schema_version,2)
 const changed=await send('/project'+query,{project_id:c.project_id,request_id:'http-edit',command:{kind:'basic_info',expected_revision:0,value:{name:'改名',creation_mode:'剧本',aspect_ratio:'16:9',output_language:'zh-CN'}}},'PATCH');assert.equal(changed.status,200);assert.equal((await changed.json()).project.basic_info.name,'改名')
 assert.equal((await send('/script-optimization'+query,{})).status,410)
 assert.equal((await fetch(base+'/node-rules'+query+'&node_type=source_analysis')).status,200)
 assert.equal((await fetch(base+'/task-history'+query+`&project_id=${c.project_id}&node_type=adaptation_plan`)).status,200)
})
test('删除解除新项目绑定，空会话不关联已删项目',async t=>{
 const f=await fixture(t),{c,context}=await created(f),result=await f.projects.remove(context)
 assert.equal(result.deleted,true);assert.equal((await f.projects.snapshot(c.session_id)).project,null);assert.equal((await f.projects.snapshot(result.session_id)).project,null);assert.deepEqual(await f.projects.listProjects(),[])
})

test('读取旧请求重试结果不会覆盖较新的Task终态投影',async t=>{
 const f=await fixture(t),{c,context}=await created(f),p=(await f.projects.snapshot(c.session_id)).project
 const result=await f.projects.edit({kind:'basic_info',expected_revision:0,value:{name:'新名称',creation_mode:'剧本',aspect_ratio:'9:16',output_language:'zh-CN'}},{...context,requestId:'new-info'})
 const expected=result.project.node_states.project.last_execution.task_id
 await f.projects.create({name:'新流程',original_script:'原稿'},{sessionId:'source',requestId:'create-1'})
 assert.equal((await f.projects.snapshot(c.session_id)).project.node_states.project.last_execution.task_id,expected)
})

test('创建在工作区命名失败后重试同请求，复用项目/工作区而保留两次真实Task',async t=>{
 const f=await fixture(t);let failed=false;f.projects.workspaceController.rename=async()=>{if(!failed){failed=true;throw new Error('模拟命名失败')}}
 const input={name:'可恢复创建',original_script:'原稿'},context={sessionId:'source',requestId:'creation-retry'}
 await assert.rejects(f.projects.create(input,context),/模拟命名失败/);const bindings=await f.projects.bindings(),id=Object.values(bindings.requests)[0].project_id
 const done=await f.projects.create(input,context);assert.equal(done.project_id,id);assert.equal(f.workspaces.length,1);assert.equal((await f.projects.listProjects()).length,1)
 const groups=f.records.tasks.store.read(f.records.scope).groups;assert.equal(groups.length,2);assert.equal(f.records.tasks.detail(f.records.scope,done.group_id).status,'completed')
})

test('项目共用弹框的资料和原稿通过一个Task联合保存，重复请求不追加版本',async t=>{
 const f=await fixture(t),{c,context}=await created(f),before=await f.projects.context(context.sessionId),{id,...value}=before.basic_info,command={kind:'basic_info',value:{...value,name:'联合新名'},source:{text:'联合新稿',original_name:'联合.txt'},expected_revision:before.node_states.project.product_revision}
 const saved=await f.projects.edit(command,{...context,requestId:'combined'});assert.equal(saved.project.basic_info.name,'联合新名');assert.equal(saved.project.source.revisions.length,2);const detail=f.records.tasks.detail(f.records.scope,saved.group_id);assert.equal(detail.tasks.length,1);assert.equal(detail.steps.length,1);assert.equal(detail.steps[0].result.saved,true);assert.equal((await f.projects.readOriginalScript(context.sessionId)).body,'联合新稿')
 await f.projects.edit(command,{...context,requestId:'combined'});assert.equal((await f.projects.context(context.sessionId)).source.revisions.length,2);await assert.rejects(f.projects.edit({...command,value:{...value,name:'被拒绝'}},{...context,requestId:'stale'}),/已被修改/);assert.equal((await f.projects.context(context.sessionId)).basic_info.name,'联合新名')
})
