import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CreateProjectTool } from '../src/tools/creat_project_tool.js'
import { ProjectManager } from '../src/project/project_manager.js'
import { apply as registerSession } from '../session.js'

const source = () => `session-${randomUUID()}`
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'drama-create-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaces = [], sessions = []
  const controllers = {
    workspaceController: {
      async create({ path }) {
        assert.ok(JSON.parse(await readFile(join(path, 'project.json'))).basic_info.id)
        const workspace = { workspaceId: randomUUID(), path }; workspaces.push(workspace); return { workspace }
      },
      async rename({ workspaceId, title }) { workspaces.find(row => row.workspaceId === workspaceId).title = title },
    },
    sessionController: { async create(request) { const sessionId = source(); sessions.push({ sessionId, ...request }); return { sessionId } } },
  }
  return { root, controllers, workspaces, sessions, tool: new CreateProjectTool({ root, ...controllers }) }
}

test('会话注册的创建工具保存 Model/JSON、独立工作区与项目会话，事件仅在落盘后发布', async t => {
  const { tool, root, workspaces, sessions } = await fixture(t)
  let registered
  registerSession({ drama: tool, tools: { register(value) { registered = value; return () => {} } }, effect(fn) { fn() } })
  assert.equal(registered.name, 'drama-create-project')
  const events = []
  tool.on('created', event => events.push(event))
  const id = source()
  const result = JSON.parse(await registered.execute({ name: '武松' }, { callId: 'create-1', agent: { session: { id } } }))
  const manager = await ProjectManager.open(join(root, 'projects', result.project_id, 'project.json'))
  const project = manager.read()
  assert.equal(project.basic_info.name, '武松')
  assert.equal(project.basic_info.original_script, '')
  assert.equal(project.basic_info.reference_episode_duration_seconds, 180)
  assert.equal(project.script_revision.node_state.status, 'empty')
  assert.ok(project.script_revision.rules.rules.generate.base)
  assert.deepEqual(project.story_segments.output.segments, [])
  assert.equal(workspaces.length, 1)
  assert.equal(sessions[0].workspaceId, result.workspace.id)
  assert.equal(sessions[0].agentPreset, 'drama')
  assert.equal(events[0].source_session_id, id)
  assert.deepEqual((await tool.snapshot(result.session_id)).project, project)
  const restarted = new CreateProjectTool({ root, workspaceController: {}, sessionController: {} })
  assert.deepEqual(await restarted.snapshot(id), await tool.snapshot(id))
})

test('并发重复调用及重启重试只创建一次；不同会话项目和工作区隔离', async t => {
  const { tool, root, controllers, workspaces, sessions } = await fixture(t)
  const input = { name: 'A' }, context = { sessionId: source(), requestId: 'one' }
  const [a, b] = await Promise.all([tool.create(input, context), tool.create(input, context)])
  assert.deepEqual(a, b)
  const restarted = new CreateProjectTool({ root, ...controllers })
  assert.deepEqual(await restarted.create(input, context), a)
  assert.equal(workspaces.length, 1); assert.equal(sessions.length, 1)
  const c = await restarted.create({ name: 'B' }, { sessionId: source(), requestId: 'two' })
  assert.notEqual(c.project_id, a.project_id)
  assert.notEqual(c.workspace.id, a.workspace.id)
  assert.notEqual(c.workspace.path, a.workspace.path)
  await assert.rejects(restarted.create({ name: 'B' }, context), /同一请求/)
  await assert.rejects(restarted.create({ name: 'C' }, { ...context, requestId: 'three' }), /已关联项目/)
})

test('工作区失败不发布成功，使用原请求恢复已保存项目，不重复初始化', async t => {
  const { tool, root, controllers, workspaces } = await fixture(t)
  const context = { sessionId: source(), requestId: 'retry' }
  const create = controllers.workspaceController.create
  controllers.workspaceController.create = async () => { throw new Error('工作区不可用') }
  let events = 0
  tool.on('created', () => events++)
  await assert.rejects(tool.create({ name: '恢复项目' }, context), /工作区不可用/)
  assert.equal(events, 0)
  assert.deepEqual(await tool.snapshot(context.sessionId), { project: null })
  const state = JSON.parse(await readFile(join(root, 'bindings.json')))
  const projectId = Object.values(state.requests)[0].project_id
  controllers.workspaceController.create = create
  const result = await tool.create({ name: '恢复项目' }, context)
  assert.equal(result.project_id, projectId)
  assert.equal(workspaces.length, 1)
  assert.equal(events, 1)
})

test('拒绝空名称、未知字段及脱离会话调用', async t => {
  const { tool } = await fixture(t)
  const context = { sessionId: source(), requestId: 'bad' }
  assert.throws(() => tool.create({ name: ' ' }, context), /项目名称/)
  assert.throws(() => tool.create({ name: 'A', id: 'fake' }, context), /字段 id/)
  await assert.rejects(tool.execute({ name: 'A' }, {}), /Harness 会话/)
  assert.deepEqual(await tool.snapshot('__proto__'), { project: null })
})
