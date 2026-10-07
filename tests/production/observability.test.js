import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  productionCoordinatorDescriptor,
  productionCoordinatorLabel,
  registerProductionCoordinator,
  syncNovelTodoTerminal,
} from '../../lib/production/observability.js'

test('production coordinator registration writes one idempotent catalog event', () => {
  const parentEvents = []
  const parent = { append: (type, data) => parentEvents.push({ type, data }) }
  const child = { id: 'studio-production-1', createdAt: 123 }

  assert.equal(registerProductionCoordinator(parent, child, '短剧全流程协调'), true)
  assert.deepEqual(parentEvents, [{
    type: 'subagent/catalog',
    data: { version: 0, childId: 'studio-production-1', childCreatedAt: 123, mode: 'one-shot', label: '短剧全流程协调' },
  }])
  assert.equal(registerProductionCoordinator(parent, child, '短剧全流程协调', [{ id: child.id }]), false)
  assert.equal(parentEvents.length, 1)
})

test('production coordinator labels are business-facing and deterministic', () => {
  assert.equal(productionCoordinatorLabel({ kind: 'novel-production-root' }), '短剧全流程协调')
  assert.equal(productionCoordinatorLabel({ kind: 'render-reference' }), '资产参考图协调')
  assert.equal(productionCoordinatorLabel({ kind: 'unknown' }), '短剧生产协调')
})

test('novel completion closes every Harness todo before the terminating tool returns', async () => {
  const calls = []
  const tools = { get: (name, agent) => ({ execute: async (args, exec) => calls.push({ name, agent, args, exec }) }) }
  const exec = { agent: { id: 'agent' } }
  assert.equal(await syncNovelTodoTerminal(tools, exec, { ok: true }), true)
  assert.equal(calls[0].name, 'todo_write')
  assert.equal(calls[0].args.todos.length, 5)
  assert.ok(calls[0].args.todos.every((todo) => todo.status === 'completed'))
})

test('novel failure clears active todos because Harness has no failed todo status', async () => {
  const calls = []
  const tools = { get: () => ({ execute: async (args) => calls.push(args) }) }
  assert.equal(await syncNovelTodoTerminal(tools, { agent: {} }, { ok: false, error: 'provider failed' }), true)
  assert.deepEqual(calls, [{ todos: [] }])
})

test('novel todo terminal sync is best-effort and never reverses the business result', async () => {
  assert.equal(await syncNovelTodoTerminal({ get: () => undefined }, { agent: {} }, { ok: true }), false)
  const warnings = []
  const tools = { get: () => ({ execute: async () => { throw new Error('todo unavailable') } }) }
  assert.equal(await syncNovelTodoTerminal(tools, { agent: {} }, { ok: true }, { warn: (...args) => warnings.push(args) }), false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].join(' '), /todo unavailable/)
})

test('production coordinator descriptor uses the host one-shot wire contract', () => {
  assert.deepEqual(productionCoordinatorDescriptor('短剧全流程协调'), {
    version: 3,
    mode: 'one-shot',
    provider: 'spawn',
    label: '短剧全流程协调',
  })
})

test('novel instructions require todo before the terminating entrypoint', async () => {
  const [guidance, skill] = await Promise.all([
    readFile(new URL('../../lib/guidance.js', import.meta.url), 'utf8'),
    readFile(new URL('../../skills/elysium-generate-drama/SKILL.md', import.meta.url), 'utf8'),
  ])
  for (const text of [guidance, skill]) {
    assert.match(text, /todo_write/)
    assert.match(text, /todo_write → studio_novel_create/)
    assert.match(text, /创建项目并导入源文/)
    assert.match(text, /合成并交付成片/)
    assert.match(text, /终态/)
    assert.match(text, /(?:严禁|禁止)调用.*ask_user_question/)
  }
})

test('production coordinator publishes visibility without changing delegation depth', async () => {
  const source = await readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /parentAgent = ctx\.agents\.get/)
  assert.match(source, /subagent\/descriptor/)
  assert.match(source, /subagentCatalog/)
  assert.doesNotMatch(source, /\.\.\.\(parentAgent \? \{ parentAgent \}/)
  assert.doesNotMatch(source, /origin: 'subagent'/)
  assert.doesNotMatch(source, /delegationDepth:/)
})

test('novel root uses the calling session so native workflow records stay top-level', async () => {
  const source = await readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /runNovelRootInCallingSession/)
  assert.match(source, /await runNovelRootInCallingSession\(\{ projectId: project\.id, taskId: rootTaskId, exec \}\)/)
  assert.match(source, /const rootExec = \{ \.\.\.exec, productionSession:/)
  assert.match(source, /response = await orchestrator\.execute\(task\.input, rootExec\)/)
  assert.match(source, /activeNovelExecs\.set\(projectId, rootExec\)/)
  assert.match(source, /const inheritedExec = activeNovelExecs\.get\(task\.input\?\.projectId\)/)
  assert.ok(source.indexOf('await syncNovelTodoTerminal(ctx.tools, exec, todoOutcome)') < source.indexOf('exec?.concludeTurn?.()'))
  assert.doesNotMatch(source, /'novel-production-root': async \(/)
  assert.doesNotMatch(source, /coordinatorKinds: \['novel-production-root'\]/)
})
