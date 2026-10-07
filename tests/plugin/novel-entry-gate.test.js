import assert from 'node:assert/strict'
import test from 'node:test'
import { INTERNAL_NOVEL_TOOLS, makeNovelEntryGateListener } from '../../lib/hooks/novel-entry-gate.js'

const nextValue = { kind: 'continue' }
const next = async () => nextValue

test('root Agent cannot bypass studio_novel_create with internal novel tools', async () => {
  const listener = makeNovelEntryGateListener()
  for (const name of INTERNAL_NOVEL_TOOLS) {
    const result = await listener({ name, agent: { session: { header: {} } } }, next)
    assert.equal(result.kind, 'deny', name)
    assert.match(result.reason, /studio_novel_create/)
  }
  assert.equal(await listener({ name: 'studio_novel_create', agent: { session: { header: {} } } }, next), nextValue)
  assert.equal(await listener({ name: 'studio_project_get', agent: { session: { header: {} } } }, next), nextValue)
})

test('workflow children can use internal novel tools', async () => {
  const listener = makeNovelEntryGateListener()
  const exec = { name: 'studio_source_read', agent: { session: { header: { parentSession: 'root' } } } }
  assert.equal(await listener(exec, next), nextValue)
})
