import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  productionCoordinatorDescriptor,
  productionCoordinatorLabel,
  productionCoordinatorSessionId,
  registerProductionCoordinator,
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

test('production coordinator identity is stable within an attempt and changes on retry', () => {
  const first = productionCoordinatorSessionId({ id: 'root-task', attemptNumber: 1 })
  assert.equal(first, productionCoordinatorSessionId({ id: 'root-task', attemptNumber: 1 }))
  assert.notEqual(first, productionCoordinatorSessionId({ id: 'root-task', attemptNumber: 2 }))
  assert.match(first, /^studio-production-[a-f0-9]{32}$/)
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
  }
})

test('production coordinator uses the complete Harness child-session contract', async () => {
  const source = await readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /parentAgent = ctx\.agents\.get/)
  assert.match(source, /\{ parentAgent \}/)
  assert.match(source, /origin: 'subagent'/)
  assert.match(source, /subagent\/descriptor/)
  assert.match(source, /subagentCatalog/)
})
