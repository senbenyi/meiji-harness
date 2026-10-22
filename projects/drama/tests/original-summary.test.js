import { scriptSummary } from '../src/node_runtime/node_state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { ProjectService } from '../src/node_box/project/service.js'
import { ProjectManager } from '../src/project_runtime/project_manager.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'drama-original-summary-')), calls = []
  const f = { root, calls, reply: input => JSON.stringify({ estimated_duration_seconds: 90, summary: `摘要：${input.original_script}` }) }
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks)), input = JSON.parse(body.messages.at(-1).content)
    calls.push(body)
    const content = await f.reply(input)
    if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const projects = new ProjectService({ root, workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} },
    sessionController: { create: async ({ sessionId }) => ({ sessionId }) } })
  const records = createRecordService(root)
  projects.configureOriginalSummary({ read: async () => ({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, text: { model: 'writer' }, output_language: 'zh-CN' }) })
  projects.enableTaskRecords(records)
  t.after(async () => { await records.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  return Object.assign(f, { projects, records })
}

const create = (f, script = '') => f.projects.create({ name: '摘要测试', original_script: script }, { sessionId: 'source', requestId: randomUUID() })

test('创建有原稿提取一次摘要、无原稿跳过；任务/提示词/调用关联，重试不重复提取', async t => {
  const f = await fixture(t), context = { sessionId: 'source', requestId: 'one' }
  const created = await f.projects.create({ name: '有原稿', original_script: '小雨归还雨伞。' }, context)
  assert.equal(created.report.summary, '摘要：小雨归还雨伞。')
  const snapshot = await f.projects.snapshot(created.session_id)
  assert.equal(snapshot.project.basic_info.summary, '摘要：小雨归还雨伞。')
  assert.equal(snapshot.project.basic_info.estimated_duration_seconds,90)
  assert.equal(snapshot.project.basic_info.create_project_node.status,'generated')
  assert.equal(created.report.estimated_duration_seconds,90)
  assert.equal(Object.hasOwn(snapshot.project.basic_info,'original_script_summary'),false)
  const detail = f.records.tasks.detail(f.records.scope, created.group_id)
  assert.equal(detail.tasks.length, 1)
  assert.equal(detail.tasks[0].id, created.report.task_id)
  assert.ok(detail.steps.every(step => step.task_id === created.report.task_id))
  assert.deepEqual(detail.steps.map(step => step.kind), ['create', 'extract_summary'])
  assert.equal(detail.steps[1].executor, 'ai')
  assert.equal(detail.steps[1].http.length, 1)
  assert.equal(detail.steps[1].http[0].prompt_id, detail.steps[1].prompt.id)
  assert.equal(f.records.http.list().length, 1)
  assert.equal(f.calls[0].model, 'writer'); assert.equal(f.calls[0].messages.length, 2)
  const repeated = await f.projects.create({ name: '有原稿', original_script: '小雨归还雨伞。' }, context)
  assert.equal(repeated.group_id, created.group_id); assert.equal(f.calls.length, 1)
  await create(f)
  await create(f, '   ')
  assert.equal(f.calls.length, 1)
  const edited = await f.projects.edit({ kind: 'basic_info', values: { name: '新标题' }, previous: { name: '有原稿' } }, { sessionId: created.session_id, projectId: created.project_id })
  assert.equal(edited.project.basic_info.summary, '摘要：小雨归还雨伞。')
})

test('导入和替换原稿均提取摘要，导入幂等，旧优化结果不被摘要操作覆盖', async t => {
  const f = await fixture(t), created = await create(f), context = { sessionId: created.session_id, projectId: created.project_id, requestId: 'import-1', source: 'ui' }
  const first = await f.projects.edit({ kind: 'import_script', value: '第一稿', previousValue: '' }, context)
  assert.equal(first.project.basic_info.summary, '摘要：第一稿')
  const detail = f.records.tasks.detail(f.records.scope, first.group_id)
  assert.equal(detail.tasks.length, 1)
  assert.ok(detail.steps.every(step => step.task_id === first.report.task_id))
  assert.notEqual(first.report.task_id, created.report.task_id)
  assert.deepEqual(detail.steps.map(step => step.kind), ['import_script', 'extract_summary'])
  const command = { kind: 'import_script', value: '第二稿', previousValue: first.project.basic_info.original_script_file_path }, nextContext = { ...context, requestId: 'import-2' }
  const next = await f.projects.edit(command, nextContext)
  await f.projects.edit(command, nextContext)
  assert.equal(f.calls.length, 2)
  assert.equal(next.project.basic_info.summary, '摘要：第二稿')
  assert.equal(next.project.basic_info.summary, '摘要：第二稿')
  await assert.rejects(f.projects.edit({ ...command, value: '越权第三稿' }, nextContext), /不同导入内容/)
})

test('摘要无效不审核不重试：创建及导入仍成功，清除旧摘要并返回警告', async t => {
  const f = await fixture(t)
  f.reply = () => '非JSON'
  const created = await create(f, '已保存原稿')
  assert.match(created.warning, /摘要未生成/)
  assert.equal(created.report.status, 'completed'); assert.equal(f.calls.length, 1)
  const context = { sessionId: created.session_id, projectId: created.project_id }
  f.reply = () => JSON.stringify({ estimated_duration_seconds: 90, summary: '旧摘要' })
  await f.projects.edit({ kind: 'import_script', value: '第二稿', previousValue: (await f.projects.snapshot(created.session_id)).project.basic_info.original_script_file_path }, context)
  f.reply = () => JSON.stringify({ estimated_duration_seconds: 90, summary: '' })
  const imported = await f.projects.edit({ kind: 'import_script', value: '第三稿', previousValue: (await f.projects.snapshot(created.session_id)).project.basic_info.original_script_file_path }, context)
  assert.match(imported.warning, /摘要未生成/)
  assert.equal(imported.project.basic_info.actual_script, '第三稿')
  assert.equal(imported.project.basic_info.summary, '')
  assert.equal(imported.report.status, 'completed'); assert.equal(f.calls.length, 3)
})

test('提取期间原稿改变时拒绝晚摘要覆盖新稿', async t => {
  const f = await fixture(t)
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  f.reply = async () => { entered(); await gate; return JSON.stringify({ estimated_duration_seconds: 90, summary: '过时摘要' }) }
  const event = once(f.projects, 'created'), pending = create(f, '原稿')
  const [created] = await event
  await started
  const manager = await ProjectManager.open(join(f.root, 'projects', created.project_id, 'project.json'))
  manager.change(project => { project.basic_info.original_script_file_path = '外部新稿'; project.basic_info.summary = '外部新摘要' })
  await manager.model.update(); release()
  const result = await pending
  assert.match(result.warning, /原稿已变化/)
  const current = (await f.projects.snapshot(created.session_id)).project
  assert.equal(current.basic_info.summary, '外部新摘要')
})

test('摘要执行期间取消不会写入晚结果，已创建项目保留', async t => {
  const f = await fixture(t)
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  f.reply = async () => { entered(); await gate; return JSON.stringify({ estimated_duration_seconds: 90, summary: '取消后的摘要' }) }
  const event = once(f.projects, 'created'), pending = create(f, '待取消原稿')
  const rejected = assert.rejects(pending, /用户取消/)
  const [created] = await event; await started
  const { group } = f.records.tasks.activeGroups(f.records.scope).find(({ tasks }) => tasks.some(task => task.metadata.project_id === created.project_id))
  f.records.tasks.cancel(f.records.scope, group.id, '用户取消')
  release(); await rejected
  assert.equal(f.records.tasks.detail(f.records.scope, group.id).status, 'cancelled')
  assert.equal((await f.projects.snapshot(created.session_id)).project.basic_info.summary, '')
})

for (const outcome of ['success', 'invalid', 'cancel']) test(`面板创建不等待摘要：${outcome}，同任务后台执行且终态停止loading`, { timeout: 5000 }, async t => {
  const f = await fixture(t)
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  f.reply = async () => { entered(); await gate; return outcome === 'invalid' ? '无效摘要' : JSON.stringify({ estimated_duration_seconds: 90, summary: '后台生成的摘要' }) }
  const context = { sessionId: 'source', requestId: 'panel-create', source: 'ui' }
  const input = { name: '即时进入项目', original_script: '完整原始剧本' }
  const created = await f.projects.create(input, context)
  await started
  assert.equal(created.status, 'running')
  const snapshot = await f.projects.snapshot(created.session_id)
  assert.equal(snapshot.project.basic_info.name, input.name)
  assert.equal(snapshot.original_summary_execution.step.kind, 'extract_summary')
  assert.equal(snapshot.project.basic_info.summary, '')
  const repeated = await f.projects.create(input, context)
  assert.equal(repeated.project_id, created.project_id); assert.equal(repeated.session_id, created.session_id)
  assert.equal(repeated.group_id, created.group_id); assert.equal(f.calls.length, 1)
  const events = []
  f.projects.on('updated', event => events.push(event))
  if (outcome === 'cancel') f.records.tasks.cancel(f.records.scope, created.group_id, '用户取消摘要')
  release(); await f.records.tasks.idle(f.records.scope)
  const final = await f.projects.snapshot(created.session_id)
  assert.equal(final.original_summary_execution, null)
  assert.equal(final.project.basic_info.summary, outcome === 'success' ? '后台生成的摘要' : '')
  assert.ok(events.some(event => event.session_ids.includes(created.session_id)))
  const detail = f.records.tasks.detail(f.records.scope, created.group_id)
  assert.equal(detail.tasks.length, 1); assert.deepEqual(detail.steps.map(step => step.kind), ['create', 'extract_summary'])
  assert.equal(detail.status, outcome === 'cancel' ? 'cancelled' : 'completed')
})


test('面板harness-http创建在摘要模型阻塞时返回目标会话和可读取项目', {timeout:5000}, async t=>{
  const f=await fixture(t)
  let release,entered
  const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
  t.after(()=>release())
  f.reply=async()=>{entered();await gate;return JSON.stringify({estimated_duration_seconds:90,summary:'后台摘要'})}
  const handler=createProjectHttpHandler(f.projects,{authorize:()=>null}),server=createServer(handler)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{release();await handler.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const base=`http://127.0.0.1:${server.address().port}`
  const response=await fetch(base+'/api/drama/projects?session_id=source',{method:'POST',headers:{'Content-Type':'application/json','X-Drama-Request':'1'},body:JSON.stringify({request_id:'http-panel',fields:{basic_info:{name:'立即打开',original_script:'完整正文'}}})})
  assert.equal(response.status,200)
  const created=await response.json();await started
  const snapshot=await (await fetch(base+'/api/drama/project?session_id='+created.session_id)).json()
  assert.equal(snapshot.project.basic_info.id,created.project_id);assert.ok(snapshot.original_summary_execution)
  release();await f.records.tasks.idle(f.records.scope)
})

test('项目节点两字段为完整输出，缺失或无效估时不保存半份结果',async t=>{
  for(const value of [{summary:'缺少时长'},{summary:'零时长',estimated_duration_seconds:0},{summary:'字符串时长',estimated_duration_seconds:'90'}]) await t.test(JSON.stringify(value),async t=>{
    const f=await fixture(t);f.reply=()=>JSON.stringify(value)
    const result=await create(f,'原始剧本')
    const {project}=await f.projects.snapshot(result.session_id)
    assert.deepEqual(scriptSummary(project),{summary:'',estimated_duration_seconds:0})
    assert.equal(project.basic_info.create_project_node.status,'generated')
    assert.match(result.warning,/摘要未生成/);assert.equal(f.calls.length,1)
  })
})

test('原稿不变但优化结果已同步时，后台提取不得覆盖较新项目output',async t=>{
  const f=await fixture(t)
  let release,entered
  const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
  t.after(()=>release())
  f.reply=async()=>{entered();await gate;return JSON.stringify({summary:'旧原稿摘要',estimated_duration_seconds:90})}
  const event=once(f.projects,'created'),pending=create(f,'原稿')
  const [created]=await event;await started
  const manager=await ProjectManager.open(join(f.root,'projects',created.project_id,'project.json'))
  const output={summary:'较新的优化摘要',estimated_duration_seconds:45}
  manager.change(project=>{Object.assign(project.basic_info,output)})
  await manager.model.update();release()
  const result=await pending
  assert.match(result.warning,/拒绝覆盖较新结果/)
  assert.deepEqual(scriptSummary((await f.projects.snapshot(created.session_id)).project),output)
})
