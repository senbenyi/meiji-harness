import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setupModel } from './model.js'
import { useWorkspaces } from './host.js'
import { outlineFixture } from './story-package.js'
import { reviewPass, reviewFail } from './review-result.js'
import { linkStore } from '../../server/data/workspace-links.js'
import { createOperationManager } from '../../server/flow/operations/operation-manager.js'
import { createHarnessJobs } from '../../server/host/harness-jobs.js'
import { subscribeProject } from '../../server/data/project-events.js'
import { operationTools } from '../../tools/session-operation-tools.js'
const root = process.argv[2], load = path => import(pathToFileURL(resolve(root, path)))
const { harness } = await load('packages/preset/agent-preset-registry/tests/harness.ts')
const { default: Goals } = await load('packages/goal/goal/src/index.ts')
const Driver = await load('packages/goal/goal-round-driver/src/index.ts')
const ToolGoal = await load('packages/goal/tool-goal/src/index.ts')
const Todo = await load('packages/todo/tool-todo/src/index.ts')
const { default: Jobs } = await load('packages/jobs/jobs-local/src/index.ts')
const ToolJobs = await load('packages/jobs/tool-jobs/src/index.ts')
const { LlmAdapter, createUserMessage } = await load('packages/llm/llm/src/index.ts')
const ctx = await harness(), cleanup = [], t = { after: fn => cleanup.push(fn) }
let current, calls, jobId, program, cursor
class PlannedAdapter extends LlmAdapter {
  async * stream() {
    const call = program[cursor++]?.()
    if (call) {
      calls.push(call.name)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `call-${randomUUID()}`, name: call.name, arguments: JSON.stringify(call.args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '本次目标已完成。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
try {
  await ctx.plugin(Goals); await ctx.plugin(Driver); await ctx.plugin(ToolGoal); await ctx.plugin(Todo, { allowParallelInProgress: false })
  await ctx.plugin(Jobs); await ctx.plugin(ToolJobs)
  ctx.effect(() => ctx.jobs.attachController('meiji'))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], new PlannedAdapter()))
  useWorkspaces(t)
  const e = await setupModel(t), requests = [], scenarios = []
  let verdict = reviewPass, failGeneration = false
  const manager = createOperationManager({ home: e.home, execute: async (op, deps) => {
    const { executeTask } = await import('../../server/flow/shared/task-executor.js')
    return executeTask(op, { ...deps, request: async message => { requests.push(message.skill); if (failGeneration) throw new Error('本次生成失败'); return message.skill === 'review' ? verdict : JSON.stringify(outlineFixture('本次生成')) } })
  } })
  const jobs = createHarnessJobs({ home: e.home, manager, registry: ctx.jobs, subscribeProject, readProject: id => e.store.read(id) })
  cleanup.push(() => { jobs.dispose(); manager.dispose() })
  const capture = { ...jobs, start: async (...args) => { const result = await jobs.start(...args); jobId = result.jobId; return result } }
  for (const tool of operationTools({ home: e.home, jobs: capture })) ctx.effect(() => ctx.tools.register(tool))
  for (const scenario of [{ onlyReview: true }, { onlyReview: false }, { onlyReview: false, failure: true }]) {
    const { onlyReview, failure = false } = scenario
    failGeneration = failure
    current = await ctx.agentLoop.create(`session-${randomUUID()}`, { provider: 'mock', model: 'mock' })
    await linkStore(e.home).selectProject(current.id, e.id, e.store)
    calls = []; cursor = 0; requests.length = 0; verdict = onlyReview ? reviewFail('动机不足') : reviewPass
    const tool = (name, args = {}) => () => ({ name, args })
    const goal = failure ? '仅重新生成第一集大纲，不扩展其他步骤' : onlyReview ? '仅审核第一集大纲，取得结论即完成，不修改' : '重新生成并审核第一集大纲，不扩展后续制作'
    const todo = (generate, review) => tool('todo_write', { todos: [...(onlyReview ? [] : [{ content: '第1集：生成大纲', status: generate }]), ...(!failure ? [{ content: '第1集：审核大纲', status: review }] : [])] })
    program = [tool('get_goal'), tool('create_goal', { objective: goal }), todo('in_progress', onlyReview ? 'in_progress' : 'pending'),
      ...(!onlyReview ? [tool('operation-generate-story', { episodeNumber: 1, mode: 'regenerate', only: 'outline', confirmDelete: true }), () => ({ name: 'job_output', args: { job_id: jobId, wait: true } }), ...(!failure ? [todo('completed', 'in_progress')] : [])] : []),
      ...(!failure ? [tool('operation-generate-story', { episodeNumber: 1, mode: 'review', only: 'outline' }), () => ({ name: 'job_output', args: { job_id: jobId, wait: true } }), todo('completed', 'completed')] : []), tool('get_goal'),
      () => { const goal = ctx.goals.get(current); return { name: 'update_goal', args: { goal_id: goal.id, revision: goal.revision, action: failure ? 'blocked' : 'complete', ...(failure ? { blocked_reason: '本次生成失败，不在授权范围内重试' } : {}) } } }]
    current.followup(createUserMessage({ content: [{ type: 'text', text: goal }], source: { kind: 'user' } }))
    await current.whenIdle(); await new Promise(setImmediate); await current.whenIdle()
    assert.equal(ctx.goals.get(current).phase, failure ? 'blocked' : 'complete')
    assert.equal(ctx.goals.get(current).roundsStarted, 0)
    assert.equal(calls.filter(name => name === 'operation-generate-story').length, onlyReview || failure ? 1 : 2)
    assert.equal(requests.length, onlyReview || failure ? 1 : 2)
    const todos = current.session.snapshotEvents().filter(event => event.type === 'todo/write').at(-1).data.todos
    assert.equal(todos.length, onlyReview || failure ? 1 : 2); assert.ok(todos.every(item => item.status === (failure ? 'in_progress' : 'completed')))
    if (!failure) assert.equal((await e.read()).plot.outline.check.passed, !onlyReview)
    scenarios.push({ steps: todos.length, goal: failure ? 'blocked' : 'complete', modelRequests: requests.length })
  }
  console.log(JSON.stringify({ scenarios, scriptedPlanner: true, realHarness: true }))
} finally { for (const fn of cleanup.reverse()) await fn(); await ctx.fiber.dispose() }
