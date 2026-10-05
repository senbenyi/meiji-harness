import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setupModel } from './model.js'
import { useWorkspaces } from './host.js'
import { linkStore } from '../../server/data/workspace-links.js'
import { findGoalOperation } from '../../server/data/operation-history.js'
import { createOperationManager } from '../../server/flow/operations/operation-manager.js'
import { createPanelGoals } from '../../server/host/harness-goals.js'
import { createHarnessJobs } from '../../server/host/harness-jobs.js'
import { subscribeProject } from '../../server/data/project-events.js'
import { startPanelOperation } from '../../server/http/panel-operation-start.js'
const root = process.argv[2]
const load = path => import(pathToFileURL(resolve(root, path)))
const { harness } = await load('packages/preset/agent-preset-registry/tests/harness.ts')
const { default: Goals } = await load('packages/goal/goal/src/index.ts')
const Driver = await load('packages/goal/goal-round-driver/src/index.ts')
const { default: Jobs } = await load('packages/jobs/jobs-local/src/index.ts')
const ToolJobs = await load('packages/jobs/tool-jobs/src/index.ts')
const { LlmAdapter } = await load('packages/llm/llm/src/index.ts')
const ctx = await harness(), cleanup = [], test = { after: fn => cleanup.push(fn) }
const requests = [], settledGoals = [], errors = []
let currentAgent, attemptMutation = false, unauthorizedExecutions = 0
class CompletionAdapter extends LlmAdapter {
  async * stream(options) {
    requests.push(options)
    assert.notEqual(ctx.goals.get(currentAgent).phase, 'active', 'goal must settle before the completion model runs')
    const text = options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (!options.messages.some(message => message.role === 'tool')) {
      assert.match(text, /面板单次操作.*不规划后续/)
      const jobId = text.match(/background job (meiji-\S+)/)?.[1]
      assert.ok(jobId)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `call-${randomUUID()}`, name: 'job_output', arguments: JSON.stringify({ job_id: jobId }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (attemptMutation && !options.messages.some(message => message.content.some(block => block.type === 'tool-call' && block.name === 'update_goal'))) {
      for (const [index, name] of ['update_goal', 'create_goal', 'todo_write', 'meiji_generate_story'].entries()) {
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'block-end', index, block: { type: 'tool-call', id: `call-${randomUUID()}`, name, arguments: '{}' } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      assert.match(JSON.stringify(options.messages), /nextAction/)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '已汇报本次操作结果。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
try {
  await ctx.plugin(Goals)
  await ctx.plugin(Driver)
  const jobsFiber = await ctx.plugin(Jobs)
  await ctx.plugin(ToolJobs)
  ctx.on('agent/error', event => errors.push(event.error))
  ctx.effect(() => ctx.jobs.attachController('meiji'))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], new CompletionAdapter()))
  for (const name of ['update_goal', 'create_goal', 'todo_write', 'meiji_generate_story']) ctx.effect(() => ctx.tools.register({ name, description: '测试越界调用', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute() { unauthorizedExecutions++; return '不应执行' } }))
  useWorkspaces(test)
  const e = await setupModel(test)
  const resolveAgent = async id => ({ agent: ctx.agents.get(id) })
  const panelGoals = createPanelGoals({ goals: ctx.goals, resolveAgent, findOperation: (sessionId, goalId) => findGoalOperation(e.home, sessionId, goalId) })
  ctx.on('agent/pre-step', (payload, next) => { panelGoals.beforeStep(payload); return next() })
  ctx.effect(() => ctx.tools.guard(exec => panelGoals.guard(exec)))
  const createAgent = async () => ctx.agentLoop.create(`session-${randomUUID()}`, { provider: 'mock', model: 'mock' })
  const terminal = []
  for (const status of ['completed', 'failed', 'cancelled']) {
    attemptMutation = status === 'cancelled'
    const agent = currentAgent = await createAgent()
    await linkStore(e.home).selectProject(agent.id, e.id, e.store)
    const gate = Promise.withResolvers()
    const manager = createOperationManager({ home: e.home, limitOf: () => 1, execute: async () => {
      await gate.promise
      if (status === 'failed') throw new Error('生成失败')
      return []
    } })
    const jobs = createHarnessJobs({ home: e.home, manager, registry: ctx.jobs, subscribeProject, readProject: id => e.store.read(id) })
    cleanup.push(() => { jobs.dispose(); manager.dispose() })
    const event = Promise.withResolvers()
    const off = ctx.jobs.events.subscribe({ owners: 'all' }, eventValue => {
      if (eventValue.type === 'settled' && eventValue.job.owner === agent.id) {
        settledGoals.push(ctx.goals.get(agent).phase)
        event.resolve(eventValue)
      }
    })
    const before = requests.length
    const result = await startPanelOperation({ ctx: { sessionController: { resolveAgent }, sessions: ctx.sessions, logger: ctx.logger }, manager, jobs, panelGoals, operation: e.op('shot-table', { origin: 'panel', sessionId: agent.id }) })
    const active = ctx.goals.get(agent)
    assert.equal(active.phase, 'active')
    assert.equal(active.activation, 'disarmed')
    await new Promise(setImmediate)
    assert.equal(requests.length, before, 'no goal round while business is running')
    const saved = await findGoalOperation(e.home, agent.id, active.id)
    assert.equal(saved.goalRef.id, active.id)
    assert.equal(saved.parameters.goalRef, undefined)
    if (status === 'cancelled') manager.cancel(result.operationId, e.id)
    gate.resolve()
    await event.promise
    await agent.whenIdle()
    await new Promise(setImmediate)
    await agent.whenIdle()
    off()
    assert.equal(requests.length - before, attemptMutation ? 3 : 2, 'job_output, optionally rejected mutation, then final response')
    assert.equal(unauthorizedExecutions, 0)
    const final = ctx.goals.get(agent)
    assert.equal(final.phase, status === 'completed' ? 'complete' : 'blocked')
    assert.equal(final.activation, 'disarmed')
    assert.equal(final.roundsStarted, 0)
    terminal.push(status)
    const replacement = await panelGoals.begin(agent, e.op('shot-table', { origin: 'panel', sessionId: agent.id }))
    assert.notEqual(replacement.ref.id, active.id)
    replacement.discard()
  }
  assert.deepEqual(settledGoals, ['complete', 'blocked', 'blocked'])
  // 不覆盖其他目标或人工修改后的目标。
  const agent = currentAgent = await createAgent()
  const foreign = ctx.goals.create(agent, { objective: '用户已有目标' }); ctx.goals.disarm(agent)
  await assert.rejects(panelGoals.begin(agent, e.op('shot-table', { sessionId: agent.id })), { code: 'GOAL_ALREADY_EXISTS' })
  assert.equal(ctx.goals.get(agent).id, foreign.id)
  ctx.goals.clear(agent, foreign)
  const owned = await panelGoals.begin(agent, e.op('shot-table', { sessionId: agent.id }))
  const edited = ctx.goals.edit(agent, owned.ref, { objective: '用户修改的目标' })
  await owned.finish({ status: 'completed' })
  assert.equal(ctx.goals.get(agent).revision, edited.revision)
  assert.equal(ctx.goals.get(agent).phase, 'active')
  ctx.goals.clear(agent, edited)
  // 模拟进程重建适配器：从真实操作记录恢复关联并结算。
  await linkStore(e.home).selectProject(agent.id, e.id, e.store)
  const pending = await panelGoals.begin(agent, e.op('shot-table', { sessionId: agent.id }))
  const manager = createOperationManager({ home: e.home, limitOf: () => 1, execute: async () => [] })
  cleanup.push(() => manager.dispose())
  const started = manager.start(e.op('shot-table', { origin: 'panel', sessionId: agent.id, goalRef: pending.ref }))
  await manager.whenEnded(started.id, { projectId: e.id })
  const restored = createPanelGoals({ goals: ctx.goals, resolveAgent, findOperation: (sessionId, goalId) => findGoalOperation(e.home, sessionId, goalId) })
  await restored.reconcile(agent)
  assert.equal(ctx.goals.get(agent).phase, 'complete')
  // 观察者销毁只脱离 job；业务结束仍结算目标。
  const detached = await panelGoals.begin(agent, e.op('shot-table', { sessionId: agent.id }))
  const gate = Promise.withResolvers(), closed = Promise.withResolvers()
  const detachedManager = createOperationManager({ home: e.home, limitOf: () => 1, execute: async () => { await gate.promise; return [] } })
  const detachedJobs = createHarnessJobs({ home: e.home, manager: detachedManager, registry: ctx.jobs, subscribeProject, readProject: id => e.store.read(id) })
  cleanup.push(() => detachedManager.dispose())
  const detachedRun = await detachedJobs.start(e.op('shot-table', { origin: 'panel', sessionId: agent.id, goalRef: detached.ref }), undefined, {}, async value => { await detached.finish(value); closed.resolve() })
  await jobsFiber.dispose()
  detachedJobs.dispose()
  assert.equal(ctx.goals.get(agent).phase, 'active')
  gate.resolve(); await closed.promise
  assert.equal((await detachedManager.whenEnded(detachedRun.operationId, { projectId: e.id })).status, 'completed')
  assert.equal(ctx.goals.get(agent).phase, 'complete')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ terminal, extraGoalRounds: 0, conflictProtected: true, recovery: true, ownerDetached: true, unauthorizedExecutions }))
} finally {
  for (const fn of cleanup.reverse()) await fn()
  await ctx.fiber.dispose()
}
