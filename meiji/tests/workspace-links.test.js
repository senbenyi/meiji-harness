import { episodeFixture } from './fixtures/model.js'
import { executeTask } from '../server/flow/shared/task-executor.js'
import { operationRequest } from '../client/operation-request.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { linkStore } from '../server/data/workspace-links.js'
import { projectStore } from '../server/data/project-store.js'
import { runOperation } from './fixtures/operation.js'
import { fakeRegistry } from './fixtures/host.js'
import { setWorkspaceRegistry } from '../server/host/harness-workspaces.js'

const sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
const oldId = '4d22904e-81db-454d-a9bd-688c513ed840'
async function fixture(fn) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-link-'))
  const rows = { [oldId]: { title: '原工作区', path: '/old', sessionIds: [sessionId] } }
  // 工作区只经 Harness 公开的 workspaceRegistry 读取；不写 workspace.json，确保代码不再依赖该文件。
  const archived = []
  const persist = async () => {}
  const registry = fakeRegistry(rows, archived)
  setWorkspaceRegistry(registry)
  const controller = {
    async create({ path }) {
      let id = Object.keys(rows).find(id => rows[id].path === path)
      if (!id) { id = randomUUID(); rows[id] = { path, title: id, sessionIds: [] }; await persist() }
      return { workspace: { workspaceId: id, ...rows[id] } }
    },
    async rename({ workspaceId, title }) {
      if (Object.entries(rows).some(([id, row]) => id !== workspaceId && row.title === title)) throw Object.assign(new Error('name-conflict'), { code: 'workspace/name-conflict' })
      rows[workspaceId].title = title
      await persist()
    },
  }
  await persist()
  const projects = projectStore(home)
  const create = title => projects.create({ title, summary: '短剧摘要' })
  try { await fn({ home, rows, archived, persist, controller, projects, create, links: linkStore(home, controller) }) }
  finally { setWorkspaceRegistry(null); await rm(home, { recursive: true, force: true }) }
}

test('each project owns a stable workspace without moving old conversations', () => fixture(async ({ rows, projects, create, links }) => {
  const a = await create('短剧 A'), b = await create('短剧 B')
  const [first, again, second] = await Promise.all([links.ensureProject(a.id, projects), links.ensureProject(a.id, projects), links.ensureProject(b.id, projects)])
  assert.equal(first.workspace.workspaceId, again.workspace.workspaceId)
  assert.notEqual(first.workspace.workspaceId, second.workspace.workspaceId)
  assert.deepEqual(rows[oldId], { title: '原工作区', path: '/old', sessionIds: [sessionId] })
  assert.equal((await projects.read(a.id)).workspaceId, first.workspace.workspaceId)
  assert.equal((await links.projectForSession(sessionId)).projectId, null)
}))

test('new sessions stay unbound until explicitly selected; other sessions and cross-project guards stay isolated', () => fixture(async ({ rows, persist, projects, create, links, home }) => {
  const a = await create('短剧 A'), b = await create('短剧 B')
  const place = await links.ensureProject(a.id, projects)
  const newId = `session-${randomUUID()}`
  rows[place.workspace.workspaceId].sessionIds.push(newId)
  await persist()
  assert.deepEqual(await links.projectForSession(newId), { workspace: null, projectId: null })
  await links.selectProject(newId, a.id, projects)
  assert.equal((await links.projectForSession(newId)).projectId, a.id)
  const otherId = `session-${randomUUID()}`
  rows[place.workspace.workspaceId].sessionIds.push(otherId)
  assert.equal((await links.projectForSession(otherId)).projectId, null)
  await assert.rejects(() => links.requireProject(newId, b.id), /创建或打开这部短剧/)
  await assert.rejects(() => runOperation({ action: 'overview', sessionId: newId, projectId: b.id, fields: { title: '错误修改', summary: '错误摘要' } }, { home }), /创建或打开这部短剧/)
  assert.equal((await projects.read(b.id)).title, '短剧 B')
}))

test('renaming preserves workspace identity and duplicate titles are disambiguated', () => fixture(async ({ rows, projects, create, links }) => {
  const a = await create('同名'), b = await create('同名')
  const first = await links.ensureProject(a.id, projects)
  const second = await links.ensureProject(b.id, projects)
  assert.equal(second.workspace.title, `同名 · ${b.id.slice(0, 8)}`)
  await projects.save(a.id, { title: '新标题' })
  const renamed = await links.ensureProject(a.id, projects)
  assert.equal(first.workspace.workspaceId, renamed.workspace.workspaceId)
  assert.equal(rows[first.workspace.workspaceId].title, '新标题')
}))

test('legacy workspace mappings do not claim ambiguous sessions', () => fixture(async ({ home, create, links, projects }) => {
  const project = await create('旧项目')
  await writeFile(join(home, 'storages', 'meiji', 'workspace-links.json'), JSON.stringify({ workspaces: { [oldId]: project.id } }))
  await projects.save(project.id, { workspaceIds: [oldId] })
  assert.equal((await links.projectForSession(sessionId)).projectId, null)
  await links.ensureProject(project.id, projects)
  const stored = JSON.parse(await readFile(join(home, 'storages', 'meiji', 'workspace-links.json'), 'utf8'))
  assert.equal(stored.workspaces[oldId], project.id)
  assert.equal((await links.projectForSession(sessionId)).projectId, null)
}))

test('HTTP selection binds current session, creates one only when absent, and rejects unrelated writes', () => fixture(async ({ home, rows, persist, controller, projects, create }) => {
  const { registerPanel } = await import('../server/http/panel-routes.js')
  const { createOperationManager } = await import('../server/flow/operations/operation-manager.js')
  let handler, manager
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    registerPanel({
      workspaceController: controller,
      sessionController: { async create({ workspaceId }) {
        const id = `session-${randomUUID()}`
        rows[workspaceId].sessionIds.push(id)
        await persist()
        return { sessionId: id }
      } },
      sessions: { get: () => ({ append() {} }) },
      connection: { requestRejection: () => null },
      webServer: { register: route => { handler = route.handler } },
      effect: fn => fn(), on() {}, logger: { warn() {} },
    }, Promise.resolve(), manager = createOperationManager({ home, workspaceController: controller, execute: (op, deps) => op.action === 'shot-table' ? Promise.resolve([]) : executeTask(op, deps) }))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
  const call = async (path, body) => {
    let status, value
    await handler({ url: '/plugins/meiji/' + path, method: 'POST', headers: { 'x-meiji-request': '1' }, async *[Symbol.asyncIterator]() { yield JSON.stringify(body) } }, {
      writeHead(code) { status = code }, end(text) { value = JSON.parse(text) },
    })
    return { ...value, status }
  }
  const project = await create('HTTP 短剧')
  const first = await call('link', { projectId: project.id })
  assert.equal(first.status, 200)
  assert.ok(rows[first.workspace.id].sessionIds.includes(first.sessionId))
  const again = await call('link', { projectId: project.id, sessionId: first.sessionId })
  assert.equal(again.sessionId, first.sessionId)
  const before = structuredClone(rows)
  const explicitId = `session-${randomUUID()}`
  const selected = await call('link', { projectId: project.id, sessionId: explicitId })
  assert.equal(selected.sessionId, explicitId)
  assert.equal((await linkStore(home).projectForSession(explicitId)).projectId, project.id)
  assert.deepEqual(rows, before, '选择项目不移动会话或自动创建会话')
  // No sessionController.prompt is provided: local edits must execute without a model turn.
  const edited = await call('turn', { action: 'overview', projectId: project.id, sessionId: first.sessionId, fields: { title: '本地修改' } })
  assert.equal(edited.status, 200)
  assert.equal(edited.completed, true)
  assert.equal(edited.project.title, '本地修改')
  assert.equal((await projects.read(project.id)).summary.content, project.summary.content)
  // Generation buttons also bypass the chat controller and return immediately.
  const blocked = await call('turn', operationRequest('shots', { projectId: project.id, sessionId: first.sessionId }))
  assert.equal(blocked.status, 409)
  await projects.save(project.id, { episodes: [episodeFixture()] })
  const generated = await call('turn', operationRequest('shots', { projectId: project.id, sessionId: first.sessionId }))
  assert.equal(generated.status, 202)
  assert.ok(generated.operationId)
  for (let attempt = 0; attempt < 100; attempt++) {
    let result
    await handler({ url: '/plugins/meiji/operations/current?' + new URLSearchParams({ projectId: project.id, sessionId: first.sessionId }), method: 'GET', headers: {} }, {
      writeHead() {}, end(text) { result = JSON.parse(text) },
    })
    if (!result.operations.length) break
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.notEqual(attempt, 99, 'background task must settle')
  }
  await manager.whenEnded(generated.operationId)
  const { EventEmitter } = await import('node:events')
  const stream = new EventEmitter(), updates = []
  stream.writeHead = code => assert.equal(code, 200)
  stream.write = text => updates.push(text)
  await handler({ url: '/plugins/meiji/events?' + new URLSearchParams({ projectId: project.id, sessionId: first.sessionId }), method: 'GET', headers: {} }, stream)
  const saved = await projects.save(project.id, { title: '推送更新' })
  assert.ok(updates.some(text => text.includes(`"revision":${saved.revision}`)))
  stream.emit('close')
  const count = updates.length
  await projects.save(project.id, { title: '断开后' })
  assert.equal(updates.length, count)
  const invalid = await call('turn', { action: 'overview', projectId: project.id, sessionId: first.sessionId, fields: { title: '', summary: '' } })
  assert.equal(invalid.status, 400)
  const rejected = await call('turn', { action: 'overview', projectId: project.id, sessionId })
  assert.equal(rejected.status, 409)
  const created = await call('turn', { action: 'create', fields: { title: '新建短剧', summary: '新的剧情' } })
  assert.equal(created.status, 201)
  assert.notEqual(created.workspace.id, first.workspace.id)
  assert.equal((await projects.read(created.projectId)).workspaceId, created.workspace.id)
  assert.deepEqual(rows[oldId].sessionIds, [sessionId])
}))
