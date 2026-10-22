import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { ScriptRevisionService } from '../src/node_box/script_revision/service.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { mount } from '../src/client/workbench.js'
import { createProjectView } from '../src/client/project-overview.js'
import { createProject } from '../src/node_box/project/create_project.js'

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'drama-delete-')),workspaces=[],deletedWorkspaces=[],registered=new Set()
  const controllers={workspaceController:{create:async()=>{const workspaceId=randomUUID();workspaces.push(workspaceId);registered.add(workspaceId);return {workspace:{workspaceId}}},rename:async()=>{},delete:async({workspaceId})=>{deletedWorkspaces.push(workspaceId);if(!registered.delete(workspaceId))throw Object.assign(new Error('不存在'),{code:'workspace/not-found'});return {deleted:true}}},sessionController:{create:async row=>({sessionId:row.sessionId||`session-${randomUUID()}`})}}
  const tool=new ProjectService({root,...controllers})
  tool.records=createRecordService(root)
  const scriptRevision=new ScriptRevisionService({projects:tool,records:tool.records,models:{read:async()=>({})}})
  const handler=createProjectHttpHandler(tool,{authorize:req=>req.headers['x-test-user']?null:401,scriptRevision}),server=createServer(handler)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await handler.dispose();await rm(root,{recursive:true,force:true})})
  const base=`http://127.0.0.1:${server.address().port}`
  const request=(path,options={})=>fetch(base+path,{...options,headers:{'X-Test-User':'1',...options.headers}})
  const remove=(result,session=result.session_id,headers={'X-Drama-Request':'1'})=>request(`/api/drama/project?session_id=${session}`,{method:'DELETE',headers,body:JSON.stringify({project_id:result.project_id})})
  return {root,tool,controllers,request,base,remove,workspaces,deletedWorkspaces,registered}
}

test('删除HTTP鉴权/绑定/活动任务保护，原子标记、列表/快照隐藏，记录与文件保留，重试及重启不恢复',async t=>{
  const {root,tool,controllers,request,base,remove,workspaces,deletedWorkspaces,registered}=await fixture(t)
  const a=await tool.create({name:'项目A',original_script:'原稿A'},{sessionId:'source-a',requestId:'a'}),b=await tool.create({name:'项目B'},{sessionId:'source-b',requestId:'b'})
  const file=join(root,'projects',a.project_id,'project.json'),before=await readFile(file,'utf8')
  assert.equal((await fetch(base+`/api/drama/project?session_id=${a.session_id}`,{method:'DELETE'})).status,401)
  assert.equal((await remove(a,a.session_id,{})).status,403)
  assert.equal((await remove(a,b.session_id)).status,403)
  assert.equal((await remove({...a,project_id:'../../escape'})).status,403)
  const path=`/api/drama/project?session_id=${a.session_id}`
  assert.equal((await request(path,{method:'DELETE',headers:{'X-Drama-Request':'1'},body:'{'})).status,422)
  assert.equal((await request(path,{method:'DELETE',headers:{'X-Drama-Request':'1'},body:' '.repeat(5000)})).status,413)
  const records=tool.records
  const active=records.tasks.submit(records.scope,{group:{metadata:{project_id:a.project_id}},tasks:[{node_type:'script_revision'}]})
  records.tasks.submit(records.scope,{group:{metadata:{project_id:b.project_id}},tasks:[{node_type:'script_revision'}]})
  assert.equal((await remove(a)).status,409)
  assert.deepEqual(deletedWorkspaces,[])
  assert.equal((await tool.snapshot(a.session_id)).project.basic_info.name,'项目A')
  records.tasks.cancel(records.scope,active.group.id)
  await records.http.record({id:'retained-http',method:'POST',path:'/test',request:{body:'历史请求'},ok:true,status:200,body:'历史返回'})
  const abort=new AbortController();t.after(()=>abort.abort())
  const events=await request(`/api/drama/events?session_id=${a.session_id}`,{signal:abort.signal}),reader=events.body.getReader()
  await reader.read()
  assert.equal((await remove(a)).status,200)
  assert.match(new TextDecoder().decode((await reader.read()).value),/updated/)
  abort.abort()
  assert.equal(registered.has(a.workspace.id),false);assert.equal(registered.has(b.workspace.id),true)
  assert.deepEqual(await tool.snapshot(a.session_id),{project:null})
  assert.deepEqual((await tool.listProjects()).map(project=>project.id),[b.project_id])
  assert.equal(await readFile(file,'utf8'),before)
  assert.equal(records.http.read('retained-http').params,'历史请求')
  assert.ok(records.tasks.detail(records.scope,active.group.id))
  const bindings=JSON.parse(await readFile(join(root,'bindings.json'),'utf8')),row=Object.values(bindings.requests).find(row=>row.project_id===a.project_id)
  assert.ok(row.deleted_at);assert.equal(bindings.sessions[a.session_id],a.project_id)
  assert.equal((await remove(a)).status,200)
  assert.equal((await request(path,{method:'PATCH',headers:{'X-Drama-Request':'1'},body:JSON.stringify({project_id:a.project_id,command:{kind:'basic_info',values:{name:'恢复'},previous:{name:'项目A'}}})})).status,410)
  const reopened=new ProjectService({root,...controllers})
  assert.deepEqual(await reopened.snapshot(a.session_id),{project:null})
  await assert.rejects(reopened.create({name:'项目A',original_script:'原稿A'},{sessionId:'source-a',requestId:'a'}),{code:'PROJECT_DELETED'})
  assert.equal(workspaces.length,2)
  // 删除后不再补发这个项目的旧创建通知；其他项目通知仍可补发。
  for(const [source,created]of[['source-a',false],['source-b',true]]){
    const stop=new AbortController(),response=await request(`/api/drama/events?session_id=${source}&cursor=0`,{signal:stop.signal})
    let text='';const timer=setTimeout(()=>stop.abort(),100)
    try { for await (const chunk of response.body) { text+=new TextDecoder().decode(chunk); if(text.includes('created')) break } }
    catch(error) { if(error.name!=='AbortError') throw error }
    finally { clearTimeout(timer);stop.abort() }
    assert.equal(text.includes('created'),created)
  }
})

test('删除与保存共用串行队列，删除后的迟到保存被拒绝',async t=>{
  const {root,tool}=await fixture(t),result=await tool.create({name:'原名'},{sessionId:'source',requestId:'serial'})
  const context={sessionId:result.session_id,projectId:result.project_id}
  const rows=await Promise.allSettled([tool.edit({kind:'basic_info',values:{name:'改名'},previous:{name:'原名'}},context),tool.remove(context),tool.edit({kind:'basic_info',values:{name:'迟到'},previous:{name:'改名'}},context)])
  assert.deepEqual(rows.map(row=>row.status),['fulfilled','fulfilled','rejected']);assert.equal(rows[2].reason.code,'PROJECT_DELETED')
  assert.equal(JSON.parse(await readFile(join(root,'projects',result.project_id,'project.json'),'utf8')).basic_info.name,'改名')
  assert.deepEqual(await tool.snapshot(result.session_id),{project:null})
})

test('标题删除按钮取消不请求，确认失败留在项目，成功及销毁清理',async t=>{
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document
  t.after(()=>{globalThis.document=previous;dom.window.close()})
  const root=document.querySelector('main'),project=await createProject({name:'确认项目'});let confirmed=false,calls=0,fail=true,message
  const view=createProjectView(root,{project,remove:async()=>{calls++;if(fail)throw new Error('保存失败');view.dispose()},confirmDelete:value=>{message=value;return confirmed}})
  const control=root.querySelector('[aria-label="删除项目"]')
  assert.ok(root.querySelector('.title-with-edit').contains(control))
  await control.onclick();assert.equal(calls,0);assert.match(message,/确认项目/);assert.match(message,/对应工作区/)
  confirmed=true;await control.onclick();assert.equal(calls,1);assert.equal(control.disabled,false);assert.equal(root.querySelector('h2').textContent,'确认项目');assert.match(root.querySelector('[role=alert]').textContent,/保存失败/)
  fail=false;await control.onclick();assert.equal(calls,2);assert.equal(root.children.length,0)
})


test('工作区删除失败不标记项目，重启后重试、重复删除及旧软删除均可完成',async t=>{
  const {root,tool,controllers,registered,deletedWorkspaces}=await fixture(t)
  const result=await tool.create({name:'重试项目'},{sessionId:'source',requestId:'retry'})
  const context={sessionId:result.session_id,projectId:result.project_id},originalDelete=controllers.workspaceController.delete
  controllers.workspaceController.delete=async()=>{throw new Error('宿主写入失败')}
  await assert.rejects(tool.remove(context),/宿主写入失败/)
  assert.equal((await tool.snapshot(result.session_id)).project.basic_info.name,'重试项目')
  let state=JSON.parse(await readFile(join(root,'bindings.json'),'utf8'))
  assert.equal(Object.values(state.requests)[0].deleted_at,undefined)
  assert.ok(registered.has(result.workspace.id))
  controllers.workspaceController.delete=originalDelete
  // 模拟宿主删除后，进程在bindings落盘前中断。
  await originalDelete({workspaceId:result.workspace.id})
  const reopened=new ProjectService({root,...controllers})
  assert.equal((await reopened.remove(context)).deleted,true)
  assert.deepEqual(await reopened.snapshot(result.session_id),{project:null})
  assert.equal((await reopened.remove(context)).deleted,true)
  // 旧版本只有deleted_at：重复删除仍移除宿主登记，多请求行同一ID去重。
  state=JSON.parse(await readFile(join(root,'bindings.json'),'utf8'))
  state.requests.duplicate=structuredClone(Object.values(state.requests)[0])
  await writeFile(join(root,'bindings.json'),JSON.stringify(state))
  registered.add(result.workspace.id)
  const before=deletedWorkspaces.length
  assert.equal((await reopened.remove(context)).deleted,true)
  assert.equal(deletedWorkspaces.length,before+1)
  assert.equal(registered.has(result.workspace.id),false)
})

test('删除后创建无项目/工作区关联的空会话，并发、重复删除及重启复用同一会话', async t => {
  const { root, tool, controllers, workspaces } = await fixture(t)
  const result = await tool.create({ name: '删除后空会话' }, { sessionId: 'origin', requestId: 'blank-after-delete' })
  const calls = [], create = controllers.sessionController.create
  controllers.sessionController.create = async args => { calls.push(structuredClone(args)); return create(args) }
  const context = { sessionId: result.session_id, projectId: result.project_id }
  const [a, b] = await Promise.all([tool.remove(context), tool.remove(context)])
  assert.ok(a.session_id); assert.notEqual(a.session_id, result.session_id)
  assert.equal(a.session_id, b.session_id); assert.equal(a.session_request_id, b.session_request_id)
  assert.deepEqual(await tool.snapshot(a.session_id), { project: null })
  assert.equal(workspaces.length, 1, '新空会话不创建工作区')
  assert.ok(calls.every(call => call.workspaceId === undefined && call.cwd === join(root, 'sessions', a.session_id)))
  const state = JSON.parse(await readFile(join(root, 'bindings.json')))
  assert.equal(state.sessions[a.session_id], undefined)
  assert.equal(state.draft_requests[a.session_request_id], a.session_id)
  const reopened = new ProjectService({ root, ...controllers })
  assert.equal((await reopened.remove(context)).session_id, a.session_id)
  assert.deepEqual(await reopened.snapshot(a.session_id), { project: null })
})

test('删除后空会话创建失败保留删除事实，使用同一请求恢复；删除失败不会创建空会话', async t => {
  const { root, tool, controllers } = await fixture(t)
  const result = await tool.create({ name: '创建失败恢复' }, { sessionId: 'origin', requestId: 'failed-blank' })
  const create = controllers.sessionController.create
  let calls = 0
  controllers.sessionController.create = async () => { calls++; throw new Error('会话服务暂不可用') }
  const context = { sessionId: result.session_id, projectId: result.project_id }
  const failed = await tool.remove(context)
  assert.equal(failed.deleted, true); assert.equal(failed.session_id, undefined)
  assert.match(failed.session_error, /项目已删除.*会话服务暂不可用/)
  assert.deepEqual(await tool.snapshot(result.session_id), { project: null })
  assert.equal(calls, 1)
  const state = JSON.parse(await readFile(join(root, 'bindings.json')))
  const reserved = state.draft_requests[failed.session_request_id]
  controllers.sessionController.create = create
  const resumed = await tool.startSession(failed.session_request_id)
  assert.equal(resumed.session_id, reserved)
  assert.equal((await tool.remove(context)).session_id, reserved)
  const other = await tool.create({ name: '删除失败' }, { sessionId: 'other', requestId: 'delete-failed' })
  controllers.sessionController.create = async () => assert.fail('删除失败不应创建空会话')
  controllers.workspaceController.delete = async () => { throw new Error('工作区删除失败') }
  await assert.rejects(tool.remove({ sessionId: other.session_id, projectId: other.project_id }), /工作区删除失败/)
})

async function mountDeletePanel(t, f, current, fetcher = f.request) {
  const dom = new JSDOM('<main/>'), previous = globalThis.document
  globalThis.document = dom.window.document
  dom.window.confirm = () => true
  let selected
  class Events { close() {} }
  const ui = mount(dom.window.document.querySelector('main'), { getSessionId: current, fetcher, Events, selectSession: id => { selected = id } })
  t.after(() => { ui.dispose(); globalThis.document = previous; dom.window.close() })
  await ui.refresh()
  return { ui, root: dom.window.document.querySelector('main'), selected: () => selected }
}

test('面板删除完成后切换到无项目空会话，原项目卡片清空', async t => {
  const f = await fixture(t), created = await f.tool.create({ name: 'UI删除' }, { sessionId: 'source', requestId: 'ui-delete' })
  const panel = await mountDeletePanel(t, f, () => created.session_id)
  await panel.root.querySelector('[aria-label="删除项目"]').onclick()
  assert.ok(panel.selected()); assert.notEqual(panel.selected(), created.session_id)
  assert.deepEqual(await f.tool.snapshot(panel.selected()), { project: null })
  assert.equal(panel.root.querySelector('[aria-label="删除项目"]'), null)
  assert.match(panel.root.querySelector('[role="status"]').textContent, /正在切换到空会话/)
})

test('面板删除后创建空会话失败显示已删除及重试入口，重试只创建独立空会话', async t => {
  const f = await fixture(t), created = await f.tool.create({ name: 'UI重试' }, { sessionId: 'source', requestId: 'ui-retry' })
  const panel = await mountDeletePanel(t, f, () => created.session_id)
  const create = f.controllers.sessionController.create
  f.controllers.sessionController.create = async () => { throw new Error('暂时不可用') }
  await panel.root.querySelector('[aria-label="删除项目"]').onclick()
  assert.equal(panel.selected(), undefined)
  assert.match(panel.root.querySelector('[role="status"]').textContent, /项目已删除.*创建空会话失败/)
  assert.equal(panel.root.querySelector('[aria-label="删除项目"]'), null)
  const retry = [...panel.root.querySelectorAll('button')].find(button => button.textContent === '重试创建空会话')
  assert.ok(retry)
  f.controllers.sessionController.create = create
  await retry.onclick()
  assert.ok(panel.selected()); assert.deepEqual(await f.tool.snapshot(panel.selected()), { project: null })
  assert.equal((await f.tool.listProjects()).length, 0)
})

test('删除请求进行中用户已切换会话，迟到响应不抢切新会话或修改另一项目', async t => {
  const f = await fixture(t), a = await f.tool.create({ name: '项目A' }, { sessionId: 'a', requestId: 'switch-a' }), b = await f.tool.create({ name: '项目B' }, { sessionId: 'b', requestId: 'switch-b' })
  let current = a.session_id, release
  const gate = new Promise(resolve => { release = resolve })
  const panel = await mountDeletePanel(t, f, () => current, async (path, options) => { if (options?.method === 'DELETE') await gate; return f.request(path, options) })
  const deleting = panel.root.querySelector('[aria-label="删除项目"]').onclick()
  current = b.session_id; release(); await deleting
  assert.equal(panel.selected(), undefined)
  assert.equal((await f.tool.snapshot(b.session_id)).project.basic_info.name, '项目B')
  assert.deepEqual(await f.tool.snapshot(a.session_id), { project: null })
})
