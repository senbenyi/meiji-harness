import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { ProjectService } from '../src/node_box/project/service.js'
import { ScriptRevisionService } from '../src/node_box/script_revision/service.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { OptimizeScriptTool } from '../src/tools/optimize_script_tool.js'
import { createRecordService } from '../src/records/service.js'
import { createProjectView } from '../src/client/project-overview.js'

const candidate = (body = '优化后的完整剧本') => ({ body, summary: '剧情摘要', estimated_duration_seconds: 180 })
const passed = { status: 'passed', issues: [] }
const issue = (status = 'content_issue') => ({ status, issues: [{ location: 'body', reason: '动作与要求不一致', suggestion: '按要求修正动作' }] })
async function fixture(t, response, { script = '原稿：主角走进房间。' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'drama-script-run-')), calls = []
  const mock = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks)), projectReview = body.messages[0].content.includes('你是主Agent的项目审核')
      const action = projectReview ? 'project_review' : body.messages.find(m => m.role === 'system').content.match(/动作：(\w+)/)[1]
      const call = { ...body, action }; calls.push(call)
      const value = await response(call, calls.length)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }))
    } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const config = { baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, output_language: 'zh-CN', text: { model: 'writer-test' }, session: { model: 'main-test' } }
  const controllers = { workspaceController: { create: async () => ({ workspace: { workspaceId: randomUUID() } }), rename: async () => {} }, sessionController: { create: async request => ({ sessionId: request.sessionId }) } }
  const projects = new ProjectService({ root, ...controllers }), models = { read: async () => config }
  projects.records = createRecordService(root)
  const scriptRevision = new ScriptRevisionService({ projects, records: projects.records, models })
  const handler = createProjectHttpHandler(projects, { authorize: req => req.headers['x-test-user'] ? null : 401, models, scriptRevision }), server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const created = await projects.create({ name: '测试剧本项目', original_script: script, creative_requirements: '保留人物关系' }, { sessionId: 'source', requestId: 'create' })
  const context = { sessionId: created.session_id, projectId: created.project_id, requestId: 'optimize' }
  const base = `http://127.0.0.1:${server.address().port}`, request = (path, options = {}) => fetch(base + path, { ...options, headers: { 'X-Test-User': '1', ...options.headers } })
  t.after(async () => { await handler.dispose(); server.closeAllConnections(); mock.closeAllConnections(); await Promise.all([new Promise(r => server.close(r)), new Promise(r => mock.close(r))]); await rm(root, { recursive: true, force: true }) })
  return { root, projects, scriptRevision, calls, created, context, request, base, models, controllers }
}
async function run(f, instruction = '人物改为缓慢转身') {
  const result = await f.scriptRevision.optimizeScript({ instruction }, f.context)
  return f.scriptRevision.waitScriptOptimization(result.group_id, f.context.sessionId)
}

test('优化生成/本地审核真实模拟HTTP并返回主Agent报告，字段保存且记录关联、幂等、源会话隔离', async t => {
  const f = await fixture(t, call => call.action === 'generate' ? candidate() : passed)
  const tool = new OptimizeScriptTool({ scriptRevision: f.scriptRevision })
  const result = JSON.parse(await tool.execute({ instruction: '人物改为缓慢转身' }, { callId: 'optimize', agent: { session: { id: f.context.sessionId } } }))
  assert.equal(result.status, 'completed'); assert.equal(result.summary, '剧情摘要')
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(project.basic_info.original_script, '原稿：主角走进房间。'); assert.deepEqual(project.script_revision.output, candidate()); assert.equal(project.script_revision.node_state.status, 'generated')
  assert.deepEqual(f.calls.map(call => [call.action, call.model]), [['generate','writer-test'],['review','writer-test']])
  assert.ok(f.calls.every(call => JSON.stringify(call.messages).includes('人物改为缓慢转身')))
  assert.ok(f.calls.every(call => !JSON.stringify(call.messages).includes('character_extraction')))
  const detail = f.projects.records.tasks.detail('drama', result.group_id)
  assert.equal(detail.steps.length, 2)
  for (const step of detail.steps) {
    assert.ok(step.prompt.id); assert.equal(step.http.length, 1)
    assert.equal(step.http[0].prompt_id, step.prompt.id)
    const row = f.projects.records.http.read(step.http[0].id)
    assert.ok(row); assert.equal(row.ok, true); assert.equal(row.params.model, step.prompt.model)
    assert.deepEqual(row.params.messages, step.prompt.messages)
  }
  const again = await run(f); assert.equal(again.group_id, result.group_id); assert.equal(f.calls.length, 2)
  await assert.rejects(f.scriptRevision.optimizeScript({ instruction: '不同要求' }, f.context), /同一请求/)
  await assert.rejects(f.scriptRevision.optimizeScript({ instruction: '修改' }, { ...f.context, sessionId: 'source' }), { code: 'PROJECT_SCOPE' })
  const reopened = createRecordService(f.root)
  assert.equal(reopened.tasks.detail('drama', result.group_id).status, 'completed'); await reopened.dispose()
})

test('已有优化稿按意见修订，本地与项目审核内容问题自动接续独立步骤，不覆盖规则和原稿', async t => {
  let generation = 0, reviews = 0
  const f = await fixture(t, call => {
    if (['generate','revise'].includes(call.action)) return candidate('第' + (++generation) + '稿')
    return ++reviews <= 2 ? issue() : passed
  })
  const result = await run(f)
  assert.equal(result.status, 'completed'); assert.equal(generation, 3)
  const detail = f.projects.records.tasks.detail('drama', result.group_id)
  assert.equal(detail.tasks.length, 1)
  assert.ok(detail.steps.every(step => step.task_id === result.task_id))
  assert.deepEqual(detail.steps.map(s => s.kind), ['generate','review','revise','review','revise','review'])
  f.context.requestId = 'next'
  const next = await run(f, '继续优化对白')
  assert.notEqual(next.task_id, result.task_id)
  assert.equal(f.projects.records.tasks.detail('drama', result.group_id).steps.length, 6)
  assert.equal(f.projects.records.tasks.detail('drama', next.group_id).steps[0].kind, 'revise')
})

test('面板harness-http与会话Tool并发提交同一优化请求，仅执行一次且快照保留执行状态', async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const f = await fixture(t, async call => {
    if (call.action === 'generate') { entered(); await gate; return candidate() }
    return passed
  })
  t.after(() => release())
  const tool = new OptimizeScriptTool({ scriptRevision: f.scriptRevision })
  const conversation = tool.execute({ instruction: '共同优化' }, { callId: 'shared', agent: { session: { id: f.context.sessionId } } })
  const response = await f.request(`/api/drama/script-optimization?session_id=${f.context.sessionId}`, {
    method: 'POST', headers: { 'X-Drama-Request': '1' },
    body: JSON.stringify({ project_id: f.context.projectId, request_id: 'shared', instruction: '共同优化' }),
  })
  assert.equal(response.status, 202)
  const accepted = await response.json(); await started
  const snapshot = await (await f.request(`/api/drama/project?session_id=${f.context.sessionId}`)).json()
  assert.deepEqual(snapshot.script_execution, { group_id: accepted.group_id, status: 'running' })
  await assert.rejects(f.projects.remove(f.context), { code: 'PROJECT_ACTIVE' })
  release()
  const result = JSON.parse(await conversation)
  assert.equal(result.group_id, accepted.group_id); assert.equal(result.status, 'completed')
  assert.deepEqual(f.calls.map(call => call.action), ['generate', 'review'])
  assert.equal(f.projects.records.tasks.store.read('drama').tasks.filter(task => task.node_type === 'script_revision').length, 1)
})

for (const status of ['rule_conflict','upstream_issue','repeated']) test('审核停止：' + status + '，保存候选且不改规则/上游', async t => {
  const f = await fixture(t, call => ['generate','revise'].includes(call.action) ? candidate() : issue(status === 'repeated' ? 'content_issue' : status))
  const before = (await f.projects.snapshot(f.context.sessionId)).project
  const result = await run(f), after = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(result.status, 'rejected'); assert.deepEqual(after.script_revision.output, candidate())
  assert.deepEqual(after.script_revision.rules, before.script_revision.rules); assert.equal(after.basic_info.original_script, before.basic_info.original_script)
  assert.equal(after.script_revision.node_state.status, 'rejected')
  assert.equal(f.calls.length, status === 'repeated' ? 4 : 2)
})

test('结构错误不保存，缺原稿不发请求，已有任务阻止重复任务和资料修改', async t => {
  const bad = await fixture(t, () => ({ body: '缺字段' }))
  const before = (await bad.projects.snapshot(bad.context.sessionId)).project.script_revision
  assert.equal((await run(bad)).status, 'failed')
  assert.deepEqual((await bad.projects.snapshot(bad.context.sessionId)).project.script_revision, before)
  const empty = await fixture(t, () => candidate(), { script: '' })
  await assert.rejects(run(empty), /导入原始剧本/); assert.equal(empty.calls.length, 0)
  let release, entered
  const gate = new Promise(r => { release = r }), started = new Promise(r => { entered = r })
  const slow = await fixture(t, async call => { if (call.action === 'generate') { entered(); await gate; return candidate() } return passed })
  const accepted = await slow.scriptRevision.optimizeScript({ instruction: '改动作' }, slow.context); await started
  await assert.rejects(slow.scriptRevision.optimizeScript({ instruction: '另一个' }, { ...slow.context, requestId: 'other' }), { code: 'PROJECT_ACTIVE' })
  await assert.rejects(slow.projects.edit({ kind: 'import_script', value: '新稿', previousValue: '原稿：主角走进房间。' }, slow.context), { code: 'PROJECT_ACTIVE' })
  slow.projects.records.tasks.cancel('drama', accepted.group_id, '测试取消'); release()
  await slow.projects.records.tasks.idle('drama')
  assert.equal(slow.projects.records.tasks.detail('drama', accepted.group_id).status, 'cancelled')
  assert.equal((await slow.projects.snapshot(slow.context.sessionId)).project.script_revision.output.body, '')
})

test('优化HTTP鉴权/绑定/请求标识、异步返回与完成后快照；下游保留内容并过期', async t => {
  const f = await fixture(t, call => call.action === 'generate' ? candidate() : passed)
  const file = join(f.root, 'projects', f.context.projectId, 'project.json')
  const data = JSON.parse(await readFile(file, 'utf8')); data.story_segments.node_state.status = 'generated'; data.story_segments.output.segments = [{ id: 'old', body: '旧内容' }]
  const { writeFile } = await import('node:fs/promises'); await writeFile(file, JSON.stringify(data))
  const path = `/api/drama/script-optimization?session_id=${f.context.sessionId}`, options = { method: 'POST', body: JSON.stringify({ project_id: f.context.projectId, request_id: 'http', instruction: '优化节奏' }) }
  assert.equal((await fetch(f.base + path, options)).status, 401)
  assert.equal((await f.request(path, options)).status, 403)
  options.headers = { 'X-Drama-Request': '1' }
  assert.equal((await f.request(path.replace(f.context.sessionId, 'other'), options)).status, 403)
  const response = await f.request(path, options); assert.equal(response.status, 202)
  const result = await response.json(); await f.scriptRevision.waitScriptOptimization(result.group_id, f.context.sessionId)
  const project = (await f.projects.snapshot(f.context.sessionId)).project
  assert.equal(project.story_segments.node_state.status, 'expired'); assert.equal(project.story_segments.output.segments[0].body, '旧内容')
})

test('页面按意见改编使用当前输入和稳定请求ID，执行状态禁用按钮，详情与历史入口保留', async t => {
  const { createProject } = await import('../src/node_box/project/create_project.js')
  const dom = new JSDOM('<main/>'), old = globalThis.document; globalThis.document = dom.window.document
  t.after(() => { globalThis.document = old; dom.window.close() })
  const project = await createProject({ name: '界面', original_script: '原稿' }), root = document.querySelector('main'), calls = []
  const view = createProjectView(root, { project, request: async () => ({}), optimize: async (...args) => { calls.push(args); return { group_id: 'group', status: 'queued' } } })
  t.after(() => view.dispose())
  const input = root.querySelector('.node-ui-opinion'); input.value = '人物缓慢转身'; input.oninput()
  await root.querySelector('.node-ui-execution button').onclick()
  assert.equal(calls[0][0], '人物缓慢转身'); assert.match(calls[0][1], /^[a-f0-9-]{36}$/)
  assert.equal(root.querySelector('.node-ui-execution button').disabled, true)
  assert.ok(root.textContent.includes('等待执行'))
  view.update(project, { scriptExecution: null }); assert.equal(root.querySelector('.node-ui-execution button').disabled, false)
})

test('本地内容问题支持超过三轮修改；规则冲突结束盒子并交还报告', async t => {
  let generation = 0, main = 0
  const f = await fixture(t, call => {
    if (['generate','revise'].includes(call.action)) return candidate('版本' + (++generation))
    if (call.action === 'review') return ++main < 5 ? issue() : passed
    return passed
  })
  assert.equal((await run(f)).status, 'completed'); assert.equal(generation, 5)
  const stopped = await fixture(t, call => call.action === 'generate' ? candidate() : call.action === 'review' ? issue('rule_conflict') : passed)
  assert.equal((await run(stopped)).status, 'rejected'); assert.equal(stopped.calls.length, 2)
})

test('执行期间外部原稿变化拒绝晚结果覆盖；中断任务重开恢复为失败，不自动重放', async t => {
  let release, entered
  const gate = new Promise(r => { release = r }), started = new Promise(r => { entered = r })
  const f = await fixture(t, async () => { entered(); await gate; return candidate() })
  const accepted = await f.scriptRevision.optimizeScript({ instruction: '优化' }, f.context); await started
  const file = join(f.root, 'projects', f.context.projectId, 'project.json'), project = JSON.parse(await readFile(file, 'utf8'))
  project.basic_info.original_script = '外部更新原稿'
  const { writeFile } = await import('node:fs/promises'); await writeFile(file, JSON.stringify(project)); release()
  assert.equal((await f.scriptRevision.waitScriptOptimization(accepted.group_id, f.context.sessionId)).status, 'failed')
  assert.equal((await f.projects.snapshot(f.context.sessionId)).project.script_revision.output.body, '')
  const records = f.projects.records
  const pending = records.tasks.submit('drama', { tasks: [{ node_type: 'script_revision', metadata: { project_id: f.context.projectId } }] })
  records.tasks.store.transaction('drama', data => { const task = data.tasks.find(row => row.group_id === pending.group.id); task.task_status = 'running'; task.started_at = new Date().toISOString() })
  const reopened = createRecordService(f.root); reopened.tasks.recover('drama')
  assert.equal(reopened.tasks.detail('drama', pending.group.id).status, 'failed'); await reopened.dispose()
})
