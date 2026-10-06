import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { assetStore } from '../server/data/asset-library-store.js'
import { projectStore } from '../server/data/project-store.js'
import { createImmediateService } from '../server/flow/immediate-service.js'
import { createProject } from '../server/flow/project-creation.js'
import { runStore } from '../server/data/run-store.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { projectSummaryFailures, MAX_SCRIPT_BYTES } from '../shared/script-content.js'
import { summaryLength } from '../shared/episode-summary.js'
import { buildEpisodePrompts } from '../server/prompts/episode-summary-prompts.js'
import { registerPanel } from '../server/http/panel-routes.js'
import { linkStore } from '../server/data/workspace-links.js'
import { projectManageTool } from '../tools/operation-project-manage.js'
import { tempHome } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'

const script = '清晨，林舟送来旧信。陈阿婆认出旧印章，带他走到废弃邮局。两人找到当年的投递记录，解开误会，相互道别。'
const stream = value => Readable.from([Buffer.from(value)])
// 创建是即时保存；项目摘要提取是制作目标（project-summary），由任务步骤执行。
async function setup(t, request) {
  const home = await tempHome(t), store = projectStore(home), library = assetStore(home)
  const rows = {}, registry = useWorkspaces(t, rows)
  const workspaceController = { create: async ({ path }) => { rows.workspace = { title: '新项目', path, sessionIds: [] }; return { workspace: { workspaceId: 'workspace' } } }, rename: async ({ title }) => { rows.workspace.title = title } }
  const edits = createImmediateService({ home, workspaceController })
  t.after(() => edits.dispose())
  const enter = async project => ({ projectId: project.id, workspaceId: project.workspaceId })
  const create = fields => createProject({ home, edits, fields, enter })
  const summarize = (projectId, deps = {}) => runOperation({ action: 'project-summary', projectId }, { home, request, ...deps })
  return { home, store, library, registry, rows, workspaceController, edits, enter, create, summarize }
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

test('项目摘要1000字按非空白Unicode字符计数，不影响剧集摘要', () => {
  assert.deepEqual(projectSummaryFailures({ summary: '😀 '.repeat(1000) }), [])
  assert.ok(projectSummaryFailures({ summary: '😀'.repeat(1001) }).length)
  for (const value of [{ summary: '' }, { summary: '  \n' }, { summary: '故事', other: true }, ['故事']]) assert.ok(projectSummaryFailures(value).length)
})

test('导入剧本创建不自动提取，按需提取摘要，有独立步骤、原文提示词和项目快照', async t => {
  const calls = [], e = await setup(t, async message => { calls.push(message); return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '林舟送旧信，与陈阿婆找到记录，解开误会。' }) })
  const asset = await e.library.import('scripts', '来信.txt', stream(script))
  const place = await e.create({ mode: 'script', title: '来信', scriptAssetId: asset.id })
  assert.equal(calls.length, 0); assert.deepEqual(await runStore(e.home, place.projectId).list(), [])
  await e.summarize(place.projectId)
  assert.equal(calls.length, 2)
  const root = await e.store.read(place.projectId)
  assert.equal(root.script, script); assert.equal(root.scriptAssetId, asset.id); assert.equal(root.scriptName, '来信.txt')
  assert.equal(root.summary.check.passed, true); assert.equal(root.summary.operation, null)
  assert.ok(summaryLength(root.summary.content) <= 1000); assert.equal(root.episodes.length, 0)
  const run = await latestRun(e.home, root.id, 'project-summary'), history = runStore(e.home, root.id)
  assert.equal(run.status, 'completed'); assert.equal(run.episodeId, null)
  assert.deepEqual(run.kinds, ['generate', 'review'])
  assert.match(JSON.stringify(await history.records(run.id, run.steps[0].id, 'prompts')), /从当前剧本及适用的 AI 创作方向/)
  assert.match(calls[0].user, new RegExp(script))
  assert.equal((await history.readRecord('artifacts', root.summary.source.artifactId)).content.summary, root.summary.content)
  await runOperation({ action: 'summary', projectId: root.id, draft: true, referenceDurationSeconds: 38 }, { home: e.home, request: async message => { calls.push(message); return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '林舟清晨送来旧信。', durationSeconds: 38 }) } })
  assert.match(calls[2].user, /参考剧本顺序与已发生剧情/)
  assert.match(calls[2].user, /时长：38 秒/)
})

test('超长项目摘要在生成步骤内按校验问题修订，保存的摘要和失败原文均可追查', async t => {
  const calls = [], e = await setup(t, async message => {
    calls.push(message)
    return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: calls.length === 1 ? '字'.repeat(1001) : '林舟送旧信，与陈阿婆解开误会。' })
  })
  const place = await e.create({ mode: 'script', title: '来信', script })
  await e.summarize(place.projectId)
  // 生成（超长）→ 同一步骤内修订 → 审核。
  assert.deepEqual(calls.map(message => message.skill === 'review'), [false, false, true])
  assert.match(calls[1].user, /不能超过 1000/)
  assert.match(calls[1].user, /最新失败稿/)
  const root = await e.store.read(place.projectId)
  assert.ok(summaryLength(root.summary.content) <= 1000)
  const run = await latestRun(e.home, root.id, 'project-summary')
  assert.deepEqual(run.steps[0].attempts.filter(attempt => attempt.kind).map(attempt => attempt.kind), ['generate', 'revise'])
  const artifacts = await runStore(e.home, root.id).listRecords('artifacts')
  assert.ok(artifacts.some(item => item.published === false && item.content.text?.includes('字'.repeat(1001))))
  assert.ok(artifacts.some(item => item.published && item.target === 'project-summary'))
})

test('提取失败保留项目和剧本，可重试；无剧本创建不调用模型', async t => {
  let fail = true, calls = 0
  const e = await setup(t, async message => { calls++; if (fail) throw new Error('network'); return message.skill === 'review' ? reviewPass : '{"summary":"忠实摘要"}' })
  const place = await e.create({ mode: 'script', title: '来信', script })
  await assert.rejects(e.summarize(place.projectId), /network/)
  const root = await e.store.read(place.projectId)
  assert.equal(root.script, script); assert.equal(root.summary.operation, null); assert.equal(root.summary.status, 'failed')
  assert.match(root.summary.error, /network/)
  fail = false
  await e.summarize(root.id)
  assert.equal((await e.store.read(root.id)).summary.error, null)
  assert.equal((await e.store.read(root.id)).summary.check.passed, true)
  const before = calls
  await e.create({ mode: 'free', premise: '人的创作方向', title: '无剧本', summary: '自行创作' })
  assert.equal(calls, before)
})

test('语义审核失败仍保存提取稿，项目状态释放并保留失败原因', async t => {
  const e = await setup(t, async message => message.skill === 'review' ? reviewFail('遗漏结局') : '{"summary":"林舟送旧信。"}')
  const place = await e.create({ mode: 'script', title: '来信', script })
  await assert.rejects(e.summarize(place.projectId), /自审未通过.*遗漏结局/)
  const root = await e.store.read(place.projectId)
  assert.equal(root.summary.content, '林舟送旧信。'); assert.equal(root.summary.check.passed, false)
  assert.equal(root.summary.operation, null); assert.equal(root.summary.status, 'failed')
  assert.match(root.summary.check.failures.join(), /遗漏结局/)
})

test('有剧本提取与无剧本创作明确分开，前后集定位范围，不输入旧摘要', () => {
  const project = { mode: 'script', summary: { content: '项目背景' }, script, scriptKind: 'imported', episodes: [{ id: 'next', durationSeconds: 38, summary: { content: '道别' } }, { id: 'target', durationSeconds: 38, summary: { content: '旧稿不要用' } }, { id: 'first', durationSeconds: 38, summary: { content: '送信' } }] }
  const prompts = buildEpisodePrompts(project, 'target')
  assert.match(prompts.generation.user, /前集定位已发生进度，后集约束结尾衔接/)
  assert.doesNotMatch(prompts.generation.user, /旧稿不要用/)
  assert.match(prompts.review('待审内容').system, /合理续写/)
  const manual = buildEpisodePrompts({ ...project, mode: 'free', premise: '人的创作方向', script: '', scriptKind: 'assembled' }, 'target')
  assert.match(manual.generation.user, /第 2 集/)
  assert.doesNotMatch(manual.generation.user, /【剧本】/)
  assert.match(manual.review('待审内容').system, /合理续写/)
})

test('面板创建导入剧本无后台任务，进入工作区后可实时查看并生成剧集', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const e = await setup(t, async message => { await gate; return message.skill === 'review' ? reviewPass : '{"summary":"林舟送信，与陈阿婆解开误会。"}' })
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = e.home
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  let handler
  registerPanel({ workspaceController: e.workspaceController, sessionController: { create: async () => { const sessionId = 'session-11111111-1111-4111-8111-111111111111'; e.rows.workspace.sessionIds.push(sessionId); return { sessionId } } },
    connection: { requestRejection: () => null }, logger: { warn() {} }, sessions: new Map(), effect: fn => fn(), on() {}, webServer: { register: value => { handler = value.handler } } }, Promise.resolve(), e.edits, { list: async () => [] })
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
  const req = stream(JSON.stringify({ action: 'create', fields: { mode: 'script', title: '来信', scriptAssetId: asset.id } }))
  Object.assign(req, { method: 'POST', url: '/plugins/meiji/turn', headers: { 'x-meiji-request': '1' } })
  let code, value
  await handler(req, { writeHead: status => { code = status }, end: text => { value = JSON.parse(text) } })
  assert.equal(code, 201, JSON.stringify(value))
  assert.ok(value.sessionId)
  assert.equal((await linkStore(e.home, e.workspaceController).projectForSession(value.sessionId)).projectId, value.projectId)
  // 创建只是即时保存：没有进行中的编辑，也没有制作任务。
  assert.deepEqual(e.edits.list(value.projectId), []); assert.deepEqual(await runStore(e.home, value.projectId).list(), []); release()
})

test('会话创建不启动提取任务，记录会话发起且绑定当前项目', async t => {
  const e = await setup(t, async message => message.skill === 'review' ? reviewPass : '{"summary":"林舟送旧信，找到记录并解开误会。"}')
  const asset = await e.library.import('scripts', '来信.txt', stream(script))
  const sessionId = 'session-22222222-2222-4222-8222-222222222222'
  const tool = projectManageTool({ home: e.home, edits: e.edits, workspaceController: e.workspaceController })
  const created = JSON.parse(await tool.execute({ action: 'create', fields: { mode: 'script', title: '会话来信', scriptAssetId: asset.id } }, { agent: { session: { id: sessionId, append() {} } }, signal: new AbortController().signal }))
  assert.equal(created.status, 'completed'); assert.deepEqual(await runStore(e.home, created.projectId).list(), [])
  assert.equal((await linkStore(e.home).projectForSession(sessionId)).projectId, created.projectId)
})

test('停止提取释放项目占用，保留完整剧本且可再次发起', async t => {
  let enterRequest
  const entered = new Promise(resolve => { enterRequest = resolve }), controller = new AbortController()
  const e = await setup(t, async ({ signal }) => {
    enterRequest()
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const place = await e.create({ mode: 'script', title: '来信', script })
  const started = e.summarize(place.projectId, { signal: controller.signal })
  await entered
  controller.abort(Object.assign(new Error('任务已停止'), { code: 'TASK_CANCELLED' }))
  await assert.rejects(started, { code: 'TASK_CANCELLED' })
  const root = await e.store.read(place.projectId)
  assert.equal(root.script, script); assert.equal(root.summary.operation, null)
  assert.equal((await latestRun(e.home, place.projectId)).status, 'cancelled')
  await e.summarize(place.projectId, { request: async message => message.skill === 'review' ? reviewPass : '{"summary":"林舟与陈阿婆解开误会。"}' })
  assert.equal((await e.store.read(place.projectId)).summary.check.passed, true)
})
