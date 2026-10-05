import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { assetStore } from '../server/data/asset-library-store.js'
import { projectStore } from '../server/data/project-store.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { executeTask } from '../server/flow/shared/task-executor.js'
import { createProject } from '../server/flow/project-creation.js'
import { recordStore, readNodePrompts } from '../server/data/task-store.js'
import { projectSummaryFailures, MAX_SCRIPT_BYTES } from '../shared/script-content.js'
import { summaryLength } from '../shared/episode-summary.js'
import { buildEpisodePrompts } from '../server/prompts/episode-summary-prompts.js'
import { registerPanel } from '../server/http/panel-routes.js'
import { linkStore } from '../server/data/workspace-links.js'
import { projectManageTool } from '../tools/session-project-manage-tool.js'
import { tempHome } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'

const script = '清晨，林舟送来旧信。陈阿婆认出旧印章，带他走到废弃邮局。两人找到当年的投递记录，解开误会，相互道别。'
const stream = value => Readable.from([Buffer.from(value)])
async function setup(t, request) {
  const home = await tempHome(t), store = projectStore(home), library = assetStore(home)
  const rows = {}, registry = useWorkspaces(t, rows)
  const workspaceController = { create: async ({ path }) => { rows.workspace = { title: '新项目', path, sessionIds: [] }; return { workspace: { workspaceId: 'workspace' } } }, rename: async ({ title }) => { rows.workspace.title = title } }
  const manager = createOperationManager({ home, workspaceController, execute: (op, deps) => executeTask(op, { ...deps, request }) })
  const enter = async project => ({ projectId: project.id, workspaceId: project.workspaceId })
  return { home, store, library, registry, rows, workspaceController, manager, enter }
}

test('剧本素材保留原文件，列表只读元数据，按需加载完整 UTF-8 正文', async t => {
  const e = await setup(t)
  const a = await e.library.import('scripts', '留言.TEXT', stream('\ufeff' + script + '\n'))
  const b = await e.library.import('scripts', '留言.TEXT', stream(script))
  assert.notEqual(a.id, b.id)
  assert.equal((await e.library.list('scripts')).length, 2)
  assert.equal(a.content, undefined)
  assert.equal((await e.library.script(a.id)).content, script)
  for (const value of [' \n', '字'.repeat(200001), Buffer.from([0xff]), 'a\0b']) await assert.rejects(e.library.import('scripts', '坏剧本.txt', stream(value)), { status: 400 })
  await assert.rejects(e.library.import('scripts', '坏剧本.md', stream(script)), { status: 400 })
  await assert.rejects(e.library.import('scripts', '过大.txt', stream('x'.repeat(MAX_SCRIPT_BYTES + 1))), { status: 413 })
  assert.equal((await e.library.list('scripts')).length, 2)
})

test('项目摘要500字按非空白Unicode字符计数，不影响剧集摘要', () => {
  assert.deepEqual(projectSummaryFailures({ summary: '😀 '.repeat(500) }), [])
  assert.ok(projectSummaryFailures({ summary: '😀'.repeat(501) }).length)
  for (const value of [{ summary: '' }, { summary: '  \n' }, { summary: '故事', other: true }, ['故事']]) assert.ok(projectSummaryFailures(value).length)
})

test('导入剧本创建项目后自动提取摘要，有独立任务、原文提示词和项目快照', async t => {
  const calls = [], e = await setup(t, async message => { calls.push(message); return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '林舟送旧信，与陈阿婆找到记录，解开误会。' }) })
  const asset = await e.library.import('scripts', '来信.txt', stream(script))
  const place = await createProject({ home: e.home, tasks: e.manager, fields: { title: '来信', scriptAssetId: asset.id, style: '写实电影' }, enter: e.enter })
  const result = await e.manager.wait(place.operationId)
  assert.equal(result.status, 'completed', JSON.stringify(result))
  assert.equal(calls.length, 2)
  const root = await e.store.read(place.projectId)
  assert.equal(root.script, script); assert.equal(root.scriptAssetId, asset.id); assert.equal(root.scriptName, '来信.txt')
  assert.equal(root.summary.check.passed, true); assert.equal(root.summary.operation, null)
  assert.ok(summaryLength(root.summary.content) <= 500); assert.equal(root.episodes.length, 0)
  const task = result.tasks[0], history = recordStore(e.home, root.id)
  assert.equal(task.type, 'project-summary')
  assert.deepEqual(task.nodes.map(node => node.kind), ['generate', 'review'])
  const prompts = await readNodePrompts(e.home, root.id, task.id, task.nodes[0].id)
  assert.match(JSON.stringify(prompts), /从剧本提取完整故事/)
  assert.match(calls[0].user, new RegExp(script))
  assert.equal((await history.read('artifacts', root.summary.source.artifactId)).content.summary, root.summary.content)
  const draft = e.manager.start({ action: 'summary', projectId: root.id, draft: true, referenceDurationSeconds: 38 })
  const episodeDraft = await draft.done
  assert.equal(episodeDraft.status, 'completed')
  assert.match(calls[2].user, /从剧本提取参考时长能容纳的连续剧情/)
  assert.match(calls[2].user, /时长：38 秒/)
})

test('超长项目摘要自动修订，保存的摘要和历史版本均可追查', async t => {
  const calls = [], e = await setup(t, async message => {
    calls.push(message)
    return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: calls.length === 1 ? '字'.repeat(501) : '林舟送旧信，与陈阿婆解开误会。' })
  })
  const place = await createProject({ home: e.home, tasks: e.manager, fields: { title: '来信', script }, enter: e.enter })
  const result = await e.manager.wait(place.operationId)
  assert.equal(result.status, 'completed', JSON.stringify(result))
  assert.equal(calls.length, 4)
  assert.match(calls[2].user, /不能超过 500/)
  assert.match(calls[2].user, /最新失败稿/)
  const root = await e.store.read(place.projectId)
  assert.ok(summaryLength(root.summary.content) <= 500)
  const artifacts = await recordStore(e.home, root.id).list('artifacts')
  assert.ok(artifacts.some(item => item.published === false && item.content.text?.includes('字'.repeat(501))))
  assert.ok(artifacts.some(item => item.published && item.target === 'project-summary'))
})

test('提取失败保留项目和剧本，可重试；无剧本创建不调用模型', async t => {
  let fail = true, calls = 0
  const e = await setup(t, async message => { calls++; if (fail) throw new Error('network'); return message.skill === 'review' ? reviewPass : '{"summary":"忠实摘要"}' })
  const place = await createProject({ home: e.home, tasks: e.manager, fields: { title: '来信', script }, enter: e.enter })
  assert.equal((await e.manager.wait(place.operationId)).status, 'failed')
  const root = await e.store.read(place.projectId)
  assert.equal(root.script, script); assert.equal(root.summary.operation, null); assert.equal(root.summary.status, 'failed')
  assert.match(root.summary.error, /network/)
  fail = false
  const retry = e.manager.start({ action: 'project-summary', projectId: root.id })
  assert.equal((await retry.done).status, 'completed')
  assert.equal((await e.store.read(root.id)).summary.error, null)
  const before = calls
  const manual = await createProject({ home: e.home, tasks: e.manager, fields: { title: '无剧本', summary: '自行创作' }, enter: e.enter })
  assert.equal(manual.operationId, undefined); assert.equal(calls, before)
})

test('语义审核失败仍保存提取稿，项目状态释放并保留失败原因', async t => {
  const e = await setup(t, async message => message.skill === 'review' ? reviewFail('遗漏结局') : '{"summary":"林舟送旧信。"}')
  const place = await createProject({ home: e.home, tasks: e.manager, fields: { title: '来信', script }, enter: e.enter })
  const result = await e.manager.wait(place.operationId)
  assert.equal(result.status, 'review_failed')
  const root = await e.store.read(place.projectId)
  assert.equal(root.summary.content, '林舟送旧信。'); assert.equal(root.summary.check.passed, false)
  assert.equal(root.summary.operation, null); assert.equal(root.summary.status, 'failed')
  assert.match(root.summary.check.failures.join(), /遗漏结局/)
})

test('有剧本提取与无剧本创作明确分开，前后集定位范围，不输入旧摘要', () => {
  const project = { summary: { content: '项目背景' }, script, episodes: [{ id: 'next', durationSeconds: 38, summary: { content: '道别' } }, { id: 'target', durationSeconds: 38, summary: { content: '旧稿不要用' } }, { id: 'first', durationSeconds: 38, summary: { content: '送信' } }] }
  const prompts = buildEpisodePrompts(project, 'target')
  assert.match(prompts.generation.user, /前集定位已发生进度，后集约束结尾衔接/)
  assert.doesNotMatch(prompts.generation.user, /旧稿不要用/)
  assert.match(prompts.review('待审内容').system, /不允许新增剧本外事件/)
  const manual = buildEpisodePrompts({ ...project, script: '' }, 'target')
  assert.match(manual.generation.user, /依据项目摘要重新生成第 2 集摘要/)
  assert.doesNotMatch(manual.generation.user, /【剧本】/)
  assert.match(manual.review('待审内容').system, /合理续写/)
})

test('面板创建导入剧本返回后台任务，进入工作区后可实时查看并生成剧集', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const e = await setup(t, async message => { await gate; return message.skill === 'review' ? reviewPass : '{"summary":"林舟送信，与陈阿婆解开误会。"}' })
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = e.home
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  let handler
  registerPanel({ workspaceController: e.workspaceController, sessionController: { create: async () => { const sessionId = 'session-11111111-1111-4111-8111-111111111111'; e.rows.workspace.sessionIds.push(sessionId); return { sessionId } } },
    connection: { requestRejection: () => null }, logger: { warn() {} }, sessions: new Map(), effect: fn => fn(), on() {}, webServer: { register: value => { handler = value.handler } } }, Promise.resolve(), e.manager)
  const stage = async (name, content) => {
    const req = stream(content)
    Object.assign(req, { method: 'POST', url: '/plugins/meiji/incoming', headers: { 'x-meiji-request': '1', 'x-meiji-category': 'scripts', 'x-meiji-name': encodeURIComponent(name), 'content-type': 'text/plain' } })
    let code, value
    await handler(req, { writeHead: status => { code = status }, end: text => { value = JSON.parse(text) } })
    return { code, value }
  }
  for (const [name, content, status] of [['空.txt', '', 400], ['无效.md', script, 400], ['二进制.txt', Buffer.from([0xff]), 400], ['过大.txt', 'x'.repeat(MAX_SCRIPT_BYTES + 1), 413]]) {
    const bad = await stage(name, content)
    assert.equal(bad.code, status, JSON.stringify(bad.value))
  }
  const incoming = await stage('来信.txt', script)
  assert.equal(incoming.code, 201)
  const importReq = stream(JSON.stringify({ action: 'library-import', sessionId: 'session-11111111-1111-4111-8111-111111111111', category: 'scripts', name: '来信.txt', incomingId: incoming.value.incomingId }))
  Object.assign(importReq, { method: 'POST', url: '/plugins/meiji/turn', headers: { 'x-meiji-request': '1' } })
  let importCode
  await handler(importReq, { writeHead: status => { importCode = status }, end() {} })
  assert.equal(importCode, 200)
  const [asset] = await e.library.list('scripts')
  assert.equal((await e.library.script(asset.id)).content, script)
  const req = stream(JSON.stringify({ action: 'create', fields: { title: '来信', scriptAssetId: asset.id } }))
  Object.assign(req, { method: 'POST', url: '/plugins/meiji/turn', headers: { 'x-meiji-request': '1' } })
  let code, value
  await handler(req, { writeHead: status => { code = status }, end: text => { value = JSON.parse(text) } })
  assert.equal(code, 201, JSON.stringify(value))
  assert.ok(value.operationId); assert.ok(value.sessionId)
  assert.equal((await linkStore(e.home, e.workspaceController).projectForSession(value.sessionId)).projectId, value.projectId)
  const current = e.manager.current(value.projectId)
  assert.equal(current.length, 1); assert.equal(current[0].action, 'project-summary')
  release()
  assert.equal((await e.manager.wait(value.operationId, value.sessionId)).status, 'completed')
})

test('会话创建也启动同一个提取任务，记录会话发起且绑定当前项目', async t => {
  const e = await setup(t, async message => message.skill === 'review' ? reviewPass : '{"summary":"林舟送旧信，找到记录并解开误会。"}')
  const asset = await e.library.import('scripts', '来信.txt', stream(script))
  const sessionId = 'session-22222222-2222-4222-8222-222222222222'
  const tool = projectManageTool({ home: e.home, tasks: e.manager, workspaceController: e.workspaceController })
  const created = JSON.parse(await tool.execute({ action: 'create', fields: { title: '会话来信', scriptAssetId: asset.id } }, { agent: { session: { id: sessionId, append() {} } }, signal: new AbortController().signal }))
  assert.equal(created.status, 'running'); assert.ok(created.operationId)
  const result = await e.manager.wait(created.operationId, sessionId)
  assert.equal(result.status, 'completed', JSON.stringify(result))
  assert.equal(result.initiator, 'session')
  assert.equal((await linkStore(e.home).projectForSession(sessionId)).projectId, created.projectId)
})

test('停止提取释放项目占用，保留完整剧本且可再次发起', async t => {
  let enterRequest
  const entered = new Promise(resolve => { enterRequest = resolve })
  const e = await setup(t, async ({ signal }) => {
    enterRequest()
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const place = await createProject({ home: e.home, tasks: e.manager, fields: { title: '来信', script }, enter: e.enter })
  await entered
  e.manager.cancel(place.operationId, place.projectId)
  const result = await e.manager.wait(place.operationId)
  assert.equal(result.status, 'cancelled')
  const root = await e.store.read(place.projectId)
  assert.equal(root.script, script); assert.equal(root.summary.operation, null)
  assert.equal(e.manager.current(place.projectId).length, 0)
  const retryManager = createOperationManager({ home: e.home, execute: (op, deps) => executeTask(op, { ...deps, request: async message => message.skill === 'review' ? reviewPass : '{"summary":"林舟与陈阿婆解开误会。"}' }) })
  assert.equal((await retryManager.start({ action: 'project-summary', projectId: place.projectId }).done).status, 'completed')
})
