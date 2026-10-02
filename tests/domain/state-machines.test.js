import test from 'node:test'
import assert from 'node:assert/strict'
import { assertTransition } from '../../lib/domain/state-machines.js'

test('state machines accept documented paths and reject skips', () => {
  assert.equal(assertTransition('shot', 'planned', 'ready'), 'ready')
  assert.equal(assertTransition('attempt', 'queued', 'running'), 'running')
  assert.throws(() => assertTransition('shot', 'planned', 'approved'), /illegal shot transition/)
  assert.throws(() => assertTransition('attempt', 'created', 'completed'), /illegal attempt transition/)
})
