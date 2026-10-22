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

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'drama-original-summary-')), calls = []
  const f = { root, calls, reply: input => JSON.stringify({ summary: `摘要：${input.original_script}` }) }
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
  assert.equal(snapshot.project.basic_info.original_script_summary, '摘要：小雨归还雨伞。')
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
  assert.equal(edited.project.basic_info.original_script_summary, '摘要：小雨归还雨伞。')
})

test('导入和替换原稿均提取摘要，导入幂等，旧优化结果不被摘要操作覆盖', async t => {
  const f = await fixture(t), created = await create(f), context = { sessionId: created.session_id, projectId: created.project_id, requestId: 'import-1', source: 'ui' }
  const first = await f.projects.edit({ kind: 'import_script', value: '第一稿', previousValue: '' }, context)
  assert.equal(first.project.basic_info.original_script_summary, '摘要：第一稿')
  const detail = f.records.tasks.detail(f.records.scope, first.group_id)
  assert.equal(detail.tasks.length, 1)
  assert.ok(detail.steps.every(step => step.task_id === first.report.task_id))
  assert.notEqual(first.report.task_id, created.report.task_id)
  assert.deepEqual(detail.steps.map(step => step.kind), ['import_script', 'extract_summary'])
  const command = { kind: 'import_script', value: '第二稿', previousValue: '第一稿' }, nextContext = { ...context, requestId: 'import-2' }
  const next = await f.projects.edit(command, nextContext)
  await f.projects.edit(command, nextContext)
  assert.equal(f.calls.length, 2)
  assert.equal(next.project.basic_info.original_script_summary, '摘要：第二稿')
  assert.equal(next.project.script_revision.output.summary, '')
  await assert.rejects(f.projects.edit({ ...command, value: '越权第三稿' }, nextContext), /不同导入内容/)
})

test('摘要无效不审核不重试：创建及导入仍成功，清除旧摘要并返回警告', async t => {
  const f = await fixture(t)
  f.reply = () => '非JSON'
  const created = await create(f, '已保存原稿')
  assert.match(created.warning, /摘要未生成/)
  assert.equal(created.report.status, 'completed'); assert.equal(f.calls.length, 1)
  const context = { sessionId: created.session_id, projectId: created.project_id }
  f.reply = () => JSON.stringify({ summary: '旧摘要' })
  await f.projects.edit({ kind: 'import_script', value: '第二稿', previousValue: '已保存原稿' }, context)
  f.reply = () => JSON.stringify({ summary: '' })
  const imported = await f.projects.edit({ kind: 'import_script', value: '第三稿', previousValue: '第二稿' }, context)
  assert.match(imported.warning, /摘要未生成/)
  assert.equal(imported.project.basic_info.original_script, '第三稿')
  assert.equal(imported.project.basic_info.original_script_summary, '')
  assert.equal(imported.report.status, 'completed'); assert.equal(f.calls.length, 3)
})

test('提取期间原稿改变时拒绝晚摘要覆盖新稿', async t => {
  const f = await fixture(t)
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  f.reply = async () => { entered(); await gate; return JSON.stringify({ summary: '过时摘要' }) }
  const event = once(f.projects, 'created'), pending = create(f, '原稿')
  const [created] = await event
  await started
  const manager = await ProjectManager.open(join(f.root, 'projects', created.project_id, 'project.json'))
  manager.change(project => { project.basic_info.original_script = '外部新稿'; project.basic_info.original_script_summary = '外部新摘要' })
  await manager.model.update(); release()
  const result = await pending
  assert.match(result.warning, /原稿已变化/)
  const current = (await f.projects.snapshot(created.session_id)).project
  assert.equal(current.basic_info.original_script_summary, '外部新摘要')
})

test('摘要执行期间取消不会写入晚结果，已创建项目保留', async t => {
  const f = await fixture(t)
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  f.reply = async () => { entered(); await gate; return JSON.stringify({ summary: '取消后的摘要' }) }
  const event = once(f.projects, 'created'), pending = create(f, '待取消原稿')
  const rejected = assert.rejects(pending, /用户取消/)
  const [created] = await event; await started
  const { group } = f.records.tasks.activeGroups(f.records.scope).find(({ tasks }) => tasks.some(task => task.metadata.project_id === created.project_id))
  f.records.tasks.cancel(f.records.scope, group.id, '用户取消')
  release(); await rejected
  assert.equal(f.records.tasks.detail(f.records.scope, group.id).status, 'cancelled')
  assert.equal((await f.projects.snapshot(created.session_id)).project.basic_info.original_script_summary, '')
})
