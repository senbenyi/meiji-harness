// 会话的项目工具：创建/打开并关联当前会话、只读创作方向、跨项目隔离。制作目标见 run-tools 测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setupModel } from './fixtures/model.js'
import { linkStore } from '../server/data/workspace-links.js'
import { createImmediateService } from '../server/flow/immediate-service.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { contextQueryTool } from '../tools/operation-context-query.js'
import { projectManageTool } from '../tools/operation-project-manage.js'
import { useWorkspaces } from './fixtures/host.js'

async function setup(t) {
  const e = await setupModel(t)
  await e.store.save(e.id, root => ({ ...root, episodes: [], scriptPendingDeletes: [], premise: '旅人的冒险' }))
  const exec = { agent: { session: { id: 'session-' + randomUUID(), append() {} } }, signal: new AbortController().signal }
  await linkStore(e.home).selectProject(exec.agent.session.id, e.id, e.store)
  const edits = createImmediateService({ home: e.home }), runs = createRunService({ home: e.home, execute: async () => ({ passed: true }) })
  t.after(async () => { await edits.dispose(); await runs.dispose() })
  return { ...e, exec, edits, runs }
}

test('session creates project using shared operation and selects it without affecting other sessions', async t => {
  const e = await setup(t), workspaceId = randomUUID()
  e.exec.agent.session.id = 'session-' + randomUUID()
  useWorkspaces(t, { [workspaceId]: { title: '穿越成武松', path: '/project', sessionIds: [] } })
  const workspaceController = { create: async () => ({ workspace: { workspaceId, sessionIds: [] } }), rename: async () => {} }
  const tool = projectManageTool({ home: e.home, edits: e.edits, workspaceController })
  await assert.rejects(tool.execute({ action: 'create', fields: { title: '' } }, e.exec), /标题/)
  const created = JSON.parse(await tool.execute({ action: 'create', fields: { mode: 'free', premise: '人的创作方向', title: '穿越成武松' } }, e.exec))
  assert.equal(created.status, 'completed')
  assert.equal((await e.store.read(created.projectId)).episodes.length, 0)
  assert.equal((await linkStore(e.home).projectForSession(e.exec.agent.session.id)).projectId, created.projectId)
  assert.equal((await linkStore(e.home).projectForSession('session-' + randomUUID())).projectId, null)
  // 创建不启动任何制作任务。
  assert.deepEqual(await e.runs.list(created.projectId, e.exec.agent.session.id), [])
})


test('会话仅可读取有效创作方向，不提供修改方向工具', async t => {
  const e = await setup(t), tool = projectManageTool({ home: e.home, edits: e.edits })
  assert.ok(!tool.parameters.properties.action.enum.includes('set-premise'))
  await assert.rejects(tool.execute({ action: 'set-premise', text: '模型改写' }, e.exec), /项目操作无效/)
  for (const scriptKind of ['assembled', 'imported']) {
    await e.store.save(e.id, { mode: scriptKind === 'assembled' ? 'free' : 'script', scriptKind, premise: '人的方向' })
    const result = JSON.parse(await contextQueryTool({ home: e.home, runs: e.runs }).execute({}, e.exec))
    assert.equal(result.current.premise, scriptKind === 'assembled' ? '人的方向' : '')
    assert.equal((await e.store.read(e.id)).premise, '人的方向')
  }
})


test('未关联会话可创建或打开项目，绑定后拒绝跨项目且不影响其他会话', async t => {
  const e = await setup(t), workspaceId = randomUUID(), freshId = 'session-' + randomUUID(), siblingId = 'session-' + randomUUID()
  useWorkspaces(t, { [workspaceId]: { title: '项目工作区', path: '/project', sessionIds: [freshId, siblingId] } })
  const exec = { ...e.exec, agent: { session: { id: freshId, append() {} } } }
  const query = contextQueryTool({ home: e.home, runs: e.runs })
  assert.equal(JSON.parse(await query.execute({}, exec)).current, null)
  const workspaceController = { create: async () => ({ workspace: { workspaceId } }), rename: async () => {} }
  const tool = projectManageTool({ home: e.home, edits: e.edits, workspaceController })
  const created = JSON.parse(await tool.execute({ action: 'create', fields: { mode: 'free', premise: '人的创作方向', title: '打虎英雄武松' } }, exec))
  assert.equal(created.title, '打虎英雄武松')
  assert.equal(JSON.parse(await query.execute({}, exec)).current.id, created.projectId)
  const before = await e.store.list()
  for (const args of [{ action: 'open', projectId: e.id }, { action: 'create', fields: { title: '无关视频' } }]) {
    await assert.rejects(tool.execute(args, exec), { status: 409, message: '当前会话已关联视频项目，请切换工作区或新建会话' })
  }
  assert.deepEqual(await e.store.list(), before)
  await tool.execute({ action: 'open', projectId: created.projectId }, exec)
  assert.equal(JSON.parse(await query.execute({}, exec)).current.id, created.projectId)
  assert.equal((await linkStore(e.home).projectForSession(siblingId)).projectId, null)
  await assert.rejects(tool.execute({ action: 'open', projectId: randomUUID() }, exec))
  assert.equal((await linkStore(e.home).projectForSession(freshId)).projectId, created.projectId)
  const sibling = { ...exec, agent: { session: { id: siblingId, append() {} } } }
  await tool.execute({ action: 'open', projectId: e.id }, sibling)
  assert.equal((await linkStore(e.home).projectForSession(siblingId)).projectId, e.id)
  assert.equal((await linkStore(e.home).projectForSession(freshId)).projectId, created.projectId)
})
