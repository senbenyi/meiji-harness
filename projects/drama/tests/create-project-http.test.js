import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { mount } from '../src/client/workbench.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'drama-http-'))
  const tool = new ProjectService({ root,
    workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} },
    sessionController: { create: async request => ({ sessionId: request.sessionId || `session-${randomUUID()}` }) },
  })
  const handler = createProjectHttpHandler(tool, { authorize: req => req.headers['x-test-user'] ? null : 401 })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => { handler.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { 'X-Test-User': '1', ...options.headers } })
  return { tool, request, base }
}

test('真实 HTTP：鉴权、UI模块、会话隔离快照及创建完成 SSE', async t => {
  const { tool, request, base } = await fixture(t)
  assert.equal((await fetch(base + '/api/drama/project?session_id=other')).status, 401)
  for (const name of ['panel.js', 'workbench.js', 'project-ui.css'])
    assert.equal((await request('/plugins/drama/src/client/' + name)).status, 200)
  const id = `session-${randomUUID()}`
  const abort = new AbortController()
  t.after(() => abort.abort())
  const events = await request('/api/drama/events?session_id=' + id, { signal: abort.signal })
  const reader = events.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /refresh/)
  const result = await tool.create({ name: '实时项目' }, { sessionId: id, requestId: 'http' })
  const message = new TextDecoder().decode((await reader.read()).value)
  assert.match(message, /created/); assert.ok(message.includes(result.project_id))
  const snapshot = await (await request('/api/drama/project?session_id=' + result.session_id)).json()
  assert.equal(snapshot.project.basic_info.name, '实时项目')
  assert.deepEqual(await (await request('/api/drama/project?session_id=other')).json(), { project: null })
  assert.equal((await request('/api/drama/projects?session_id=other', { method: 'POST', body: '{}' })).status, 403)
  abort.abort()
})

test('UI收到会话工具创建事件后重新读取JSON快照、刷新项目名并选择项目新会话', async t => {
  const { tool, request } = await fixture(t)
  const dom = new JSDOM('<main></main>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  let stream, selected
  class Events {
    constructor() { stream = this }
    close() {}
  }
  const id = `session-${randomUUID()}`
  const root = document.querySelector('main')
  const ui = mount(root, { getSessionId: () => id, fetcher: request, Events, selectSession: value => { selected = value } })
  t.after(() => ui.dispose())
  await ui.refresh()
  assert.ok(root.querySelector('.home-empty [aria-label="创建项目"]'))
  assert.equal(root.querySelector('button.library').textContent, '片库')
  assert.equal(root.querySelector('button.settings').textContent, '设置')
  await root.querySelector('button.settings').onclick()
  assert.equal(root.querySelector('.settings-page h2').textContent, '设置')
  root.querySelector('.settings-page button').click()
  assert.ok(root.querySelector('.home-empty'))
  root.querySelector('button.library').click()
  const libraryBack = root.querySelector('.library-heading .back')
  assert.equal(libraryBack.getAttribute('aria-label'), '返回上一页')
  libraryBack.click()
  assert.ok(root.querySelector('.home-empty'))
  root.querySelector('button.library').click()
  await root.querySelector('button.settings').onclick()
  const back = root.querySelector('.settings-page .back')
  assert.equal(back.getAttribute('aria-label'), '返回上一页')
  back.click()
  assert.equal(root.querySelector('h2'), null)
  assert.equal(root.querySelector('[role=tab][aria-selected=true]').textContent, '项目')
  ui.dispose()
  const refreshed = mount(root, { getSessionId: () => id, fetcher: request, Events, selectSession: value => { selected = value } })
  t.after(() => refreshed.dispose())
  await refreshed.refresh()
  const result = await tool.create({ name: '界面刷新' }, { sessionId: id, requestId: 'ui' })
  stream.onmessage({ data: JSON.stringify({ type: 'created', ...result }) })
  for (let i = 0; i < 50 && !selected; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(selected, result.session_id)
  assert.notEqual(selected, id)
  refreshed.dispose()
  const projectUi = mount(root, { getSessionId: () => selected, fetcher: request, Events })
  t.after(() => projectUi.dispose())
  await projectUi.refresh()
  assert.equal(root.querySelector('h2').textContent, '界面刷新')
  assert.match(root.textContent, /原始剧本/)
  root.querySelector('button.library').click()
  root.querySelector('.library-heading .back').click()
  assert.equal(root.querySelector('h2').textContent, '界面刷新')
})


test('无工作区启动 HTTP 需鉴权与请求标识，重复请求返回同一未绑定会话', async t => {
  const { request, base } = await fixture(t)
  const path = '/api/drama/sessions'
  assert.equal((await fetch(base + path, { method: 'POST' })).status, 401)
  assert.equal((await request(path, { method: 'POST', body: '{}' })).status, 403)
  const options = { method: 'POST', headers: { 'X-Drama-Request': '1' }, body: JSON.stringify({ request_id: randomUUID() }) }
  const first = await (await request(path, options)).json()
  assert.match(first.session_id, /^session-/)
  assert.deepEqual(await (await request(path, options)).json(), first)
  assert.deepEqual(await (await request('/api/drama/project?session_id=' + first.session_id)).json(), { project: null })
  assert.equal((await request(path, { ...options, body: '{}' })).status, 422)
})

test('无选中会话时自动准备会话；准备失败可重试，销毁后不切换', async t => {
  const { request } = await fixture(t)
  const dom = new JSDOM('<main></main>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  let selected, failures = 1
  const fetcher = async (url, options) => {
    if (url.includes('/sessions?') && failures-- > 0) return { ok: false, json: async () => ({ message: '启动失败' }) }
    return request(url, options)
  }
  const root = document.querySelector('main')
  const ui = mount(root, { getSessionId: () => null, fetcher, selectSession: value => { selected = value } })
  t.after(() => ui.dispose())
  for (let i = 0; i < 50 && !root.textContent.includes('启动失败'); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.match(root.textContent, /启动失败/)
  root.querySelector('[aria-label="开始会话"]').click()
  for (let i = 0; i < 50 && !selected; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.match(selected, /^session-/)
  ui.dispose()
  selected = null
  let release
  const pending = new Promise(resolve => { release = resolve })
  const disposed = mount(root, { getSessionId: () => null, fetcher: () => pending, selectSession: value => { selected = value } })
  disposed.dispose()
  release({ ok: true, json: async () => ({ session_id: 'late' }) })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(selected, null)
})


test('片库HTTP独立于会话，剧本持久化导入并用于项目创建', async t => {
  const { request, tool, base } = await fixture(t)
  assert.equal((await fetch(base + '/api/drama/library')).status, 401)
  assert.deepEqual(await (await request('/api/drama/library')).json(), { projects: [], assets: [] })
  assert.equal((await request('/api/drama/library/scripts', { method: 'POST', body: '{}' })).status, 403)
  const options = { method: 'POST', headers: { 'X-Drama-Request': '1' }, body: JSON.stringify({ originalName: '素材剧本.txt', body: '第一幕\n人物出场。' }) }
  const imported = await request('/api/drama/library/scripts', options)
  assert.equal(imported.status, 201)
  const { asset } = await imported.json()
  const body = await (await request('/api/drama/library/scripts/' + asset.id)).json()
  assert.equal(body.body, '第一幕\n人物出场。')
  const result = await tool.create({ name: '素材项目', original_script: body.body, original_script_filename:'素材剧本.txt' }, { sessionId: 'source', requestId: 'library' })
  const library = await (await request('/api/drama/library')).json()
  assert.equal(library.assets[0].originalName, '素材剧本.txt')
  assert.equal('body' in library.assets[0], false)
  assert.equal(library.projects[0].name, '素材项目')
  assert.equal(library.projects[0].session_id, result.session_id)
  const original = await (await request('/api/drama/original-script?session_id='+result.session_id)).json()
  assert.deepEqual(original,{body:body.body,originalName:'素材剧本.txt'})
  assert.equal((await request('/api/drama/original-script?session_id=unknown')).status,422)
  assert.equal((await tool.snapshot(result.session_id)).project.basic_info.actual_script, body.body)
  assert.equal((await request('/api/drama/library/scripts/..%2Fbindings.json')).status, 422)
  assert.equal((await request('/api/drama/library/scripts', { ...options, body: JSON.stringify({ originalName: 'bad.exe', body: 'bad' }) })).status, 422)
})

test('顶部标题及加号始终可创建，片库双层tab与素材剧本正文导入', async t => {
  const { tool, request } = await fixture(t)
  const { createLibraryStore } = await import('../src/library/library_store.js')
  const asset = await createLibraryStore(tool.root).importScript({ originalName: '复用剧本.txt', body: '素材库中的剧本正文' })
  const dom = new JSDOM('<main></main>'), previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  const root = document.querySelector('main')
  let selected
  class Events { close() {} }
  const ui = mount(root, { getSessionId: () => 'source', fetcher: request, Events, selectSession: id => { selected = id } })
  t.after(() => ui.dispose())
  await ui.refresh()
  assert.equal(root.querySelector('header .brand').textContent, '短剧制作')
  root.querySelector('button.library').click()
  assert.equal(root.querySelector('h2'), null)
  assert.deepEqual([...root.querySelectorAll('[aria-label="片库分类"] button')].map(b => b.textContent), ['项目', '素材'])
  root.querySelector('#library-tab-assets').click()
  assert.deepEqual([...root.querySelectorAll('[aria-label="素材分类"] button')].map(b => b.textContent), ['人物', '衣服', '道具', '剧本'])
  root.querySelector('#library-tab-scripts').click()
  for (let i = 0; i < 50 && !root.textContent.includes('复用剧本.txt'); i++) await new Promise(r => setTimeout(r, 5))
  assert.match(root.textContent, /复用剧本.txt/)
  await root.querySelector('button.settings').onclick()
  root.querySelector('.back').click()
  assert.equal(root.querySelector('#library-tab-scripts').getAttribute('aria-selected'), 'true')
  root.querySelector('header .create-project').click()
  const dialog = root.querySelector('#create-project')
  assert.equal(dialog.querySelector('.script-choose').hidden, false)
  assert.equal(dialog.querySelector('.script-choose').textContent, '素材库导入')
  await dialog.querySelector('.script-choose').onclick()
  dialog.querySelector('.script-picker').value = asset.id
  await dialog.querySelector('.script-picker').onchange()
  assert.equal(dialog.querySelector('#title').value, '复用剧本')
  await dialog.querySelector('form').onsubmit({ preventDefault() {} })
  assert.ok(selected)
  assert.equal((await tool.snapshot(selected)).project.basic_info.actual_script, '素材库中的剧本正文')
  assert.equal(root.querySelector('header .brand').textContent, '短剧制作')
})

test('记录接口认证、独立持久化、任务详情与公共浏览器模块依赖完整', async t => {
  const { tool, request, base } = await fixture(t)
  assert.equal((await fetch(base + '/api/drama/http-records')).status, 401)
  const transfer = { id: randomUUID(), method: 'POST', path: '/model', request: { body: { prompt: 'test' } } }
  await tool.records.http.record(transfer)
  assert.equal((await (await request('/api/drama/http-records')).json()).records[0].id, transfer.id)
  Object.assign(transfer, { status: 200, ok: true, body: { result: 'saved' } }); await tool.records.http.record(transfer)
  const http = (await (await request(`/api/drama/http-records?id=${transfer.id}`)).json()).record
  assert.deepEqual(http.response, { result: 'saved' })
  assert.equal((await request('/api/drama/http-records?offset=-1')).status, 422)
  assert.equal((await request('/api/drama/http-records?id=missing')).status, 404)
  assert.equal((await request('/api/drama/http-records', { method: 'POST' })).status, 405)
  tool.records.tasks.register('test', { plan: () => [{ kind: 'execute' }], execute: async ctx => {
    ctx.recordHttp({ method: 'GET', path: '/task', request: { method: 'GET' }, status: 200, body: 'task response' }); return { result: 'finished' }
  } })
  const group = tool.records.tasks.submit(tool.records.scope, { tasks: [{ node_type: 'test', name: '真实任务' }] })
  tool.records.tasks.start(tool.records.scope); await tool.records.tasks.idle(tool.records.scope)
  const history = await (await request('/api/drama/task-history')).json()
  assert.equal(history.total, 1); assert.ok(history.nodeTypes.some(row => row.label === '剧本优化'))
  const taskHistory = await (await request('/api/drama/task-history?unit=task&status=completed&node_type=test')).json()
  assert.equal(taskHistory.total,1);assert.equal(taskHistory.tasks[0].id,group.tasks[0].id)
  assert.equal(Object.hasOwn(taskHistory,'groups'),false)
  const detail = (await (await request(`/api/drama/task-history?id=${group.group.id}`)).json()).detail
  assert.equal(detail.steps[0].http[0].body, 'task response')
  for (const path of ['ui/index.js', 'task/index.js', 'task/styles.js', 'http-client/index.js', 'http-client/styles.js']) {
    const response = await request('/plugins/drama/packages/' + path); assert.equal(response.status, 200)
    assert.doesNotMatch(await response.text(), /from '@agent-modules\//)
  }
  assert.equal((await request('/plugins/drama/packages/missing.js')).status, 404)
  const source = await (await request('/plugins/drama/src/client/workbench.js')).text()
  assert.match(source, /from '\/plugins\/drama\/packages\/task\/index.js'/)
  assert.ok(source.includes("from '/plugins/drama/packages/ui/index.js'"))
  const { createRecordService } = await import('../src/records/service.js')
  const reopened = createRecordService(tool.root)
  assert.equal(reopened.http.read(transfer.id).response.result, 'saved')
  assert.equal(reopened.tasks.history(reopened.scope).total, 1)
  await reopened.dispose()
})

test('释放SSE期间的项目创建通知在恢复连接后补发，不跨会话或重复补发', async t => {
  const {tool,request}=await fixture(t)
  const source=`session-${randomUUID()}`
  const abort=new AbortController();t.after(()=>abort.abort())
  const initial=await request(`/api/drama/events?session_id=${source}`,{signal:abort.signal})
  const first=new TextDecoder().decode((await initial.body.getReader().read()).value)
  const cursor=JSON.parse(first.split('data: ')[1].trim()).cursor
  abort.abort()
  const result=await tool.create({name:'后台完成'},{sessionId:source,requestId:'missed'})
  const resume=new AbortController();t.after(()=>resume.abort())
  const stream=await request(`/api/drama/events?session_id=${source}&cursor=${cursor}`,{signal:resume.signal})
  const reader=stream.body.getReader();let data=''
  for(let i=0;i<2&&!data.includes('created');i++) data+=new TextDecoder().decode((await reader.read()).value)
  assert.match(data,/created/);assert.ok(data.includes(result.session_id))
  const messages=data.split('\n\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)))
  const last=Math.max(...messages.map(event=>event.cursor))
  resume.abort()
  for(const path of [`session_id=other&cursor=${cursor}`,`session_id=${source}&cursor=${last}`]){
    const stop=new AbortController();const response=await request('/api/drama/events?'+path,{signal:stop.signal})
    const text=new TextDecoder().decode((await response.body.getReader().read()).value)
    assert.match(text,/refresh/);assert.doesNotMatch(text,/created/);stop.abort()
  }
})

test('刷新恢复同工作区另一会话时，面板读写项目及SSE同步，其他工作区和同名项目隔离', async t => {
  const {tool,request}=await fixture(t)
  const first=await tool.create({name:'月界旅行',original_script:'原稿正文'},{sessionId:'source',requestId:'workspace-a'})
  const second=await tool.create({name:'月界旅行'},{sessionId:'other-source',requestId:'workspace-b'})
  const sibling='session-workspace-sibling',foreign='session-workspace-foreign'
  const workspaces=[{...first.workspace,sessionIds:[first.session_id,sibling]},{...second.workspace,sessionIds:[second.session_id,foreign]}]
  tool.workspaceForSession=id=>workspaces.find(row=>row.sessionIds.includes(id))
  const snapshot=await (await request(`/api/drama/project?session_id=${sibling}`)).json()
  assert.equal(snapshot.project.basic_info.id,first.project_id)
  assert.equal(snapshot.session_id,sibling)
  assert.deepEqual(await tool.snapshot('unrelated'),{project:null})
  assert.equal((await tool.snapshot(foreign)).project.basic_info.id,second.project_id)
  const original=await (await request(`/api/drama/original-script?session_id=${sibling}`)).json()
  assert.equal(original.body,'原稿正文')
  const options={method:'PATCH',headers:{'X-Drama-Request':'1'},body:JSON.stringify({project_id:first.project_id,command:{kind:'node_opinion',value:'调整节奏',previousValue:''}})}
  assert.equal((await request(`/api/drama/project?session_id=${foreign}`,options)).status,403)
  assert.equal((await request(`/api/drama/project?session_id=${sibling}`,options)).status,200)
  assert.equal((await tool.snapshot(first.session_id)).project.basic_info.script_revision_node.opinion,'调整节奏')
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document
  let stream
  class Events{constructor(){stream=this}close(){}}
  const ui=mount(document.querySelector('main'),{getSessionId:()=>sibling,fetcher:request,Events})
  t.after(()=>{ui.dispose();globalThis.document=previous;dom.window.close()})
  await ui.refresh()
  assert.equal(document.querySelector('h2').textContent,'月界旅行')
  assert.ok(stream)
  const abort=new AbortController();t.after(()=>abort.abort())
  const response=await request(`/api/drama/events?session_id=${sibling}`,{signal:abort.signal})
  const reader=response.body.getReader();await reader.read()
  tool.emit('updated',{project_id:first.project_id,session_ids:[first.session_id]})
  assert.match(new TextDecoder().decode((await reader.read()).value),/updated/)
  abort.abort()
  const state={sessions:{},requests:{pending:{project_id:first.project_id,workspace:first.workspace}}}
  assert.equal(tool.projectIdForSession(state,sibling),null,'未完成创建不能按工作区关联')
  state.requests.pending.session_id=first.session_id
  assert.equal(tool.projectIdForSession(state,sibling),first.project_id)
  state.requests.pending.deleted_at='deleted'
  assert.equal(tool.projectIdForSession(state,sibling),null)
  state.requests.pending.deleted_at=null;state.requests.pending.workspace={...first.workspace,id:'different-workspace'}
  assert.equal(tool.projectIdForSession(state,sibling),null,'工作区ID与路径必须同时匹配')
})

test('切换会话后旧快照迟到不覆盖新工作区项目', async t => {
  const {createProject}=await import('../src/node_box/project/create_project.js')
  const a=await createProject({name:'旧工作区'}),b=await createProject({name:'月界旅行'})
  const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document
  let selected='old',follow,release
  const gate=new Promise(resolve=>{release=resolve})
  const interval=globalThis.setInterval
  globalThis.setInterval=(callback,delay)=>{follow=callback;return interval(callback,delay)}
  class Events{close(){}}
  let ui
  try{ui=mount(document.querySelector('main'),{getSessionId:()=>selected,Events,fetcher:async url=>{
    const id=new URL(url,'http://localhost').searchParams.get('session_id')
    if(id==='old')await gate
    return{ok:true,json:async()=>({project:id==='old'?a:b})}
  }})}finally{globalThis.setInterval=interval}
  t.after(()=>{release();ui.dispose();globalThis.document=previous;dom.window.close()})
  selected='new';follow()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(document.querySelector('h2').textContent,'月界旅行')
  release();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(document.querySelector('h2').textContent,'月界旅行')
})
