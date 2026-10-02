import test from 'node:test'
import assert from 'node:assert/strict'
import { assertTransition } from '../../lib/domain/state-machines.js'
import { collectDependents, invalidateDependents } from '../../lib/domain/invalidation.js'

test('state machines accept documented paths and reject skips', () => {
  assert.equal(assertTransition('shot', 'planned', 'ready'), 'ready')
  assert.equal(assertTransition('attempt', 'queued', 'running'), 'running')
  assert.throws(() => assertTransition('shot', 'planned', 'approved'), /illegal shot transition/)
  assert.throws(() => assertTransition('attempt', 'created', 'completed'), /illegal attempt transition/)
})

test('downloading → cancelled transition is valid', () => {
  assert.equal(assertTransition('attempt', 'downloading', 'cancelled'), 'cancelled')
})

test('timeline ready → ready and exported → ready transitions are valid', () => {
  assert.equal(assertTransition('timeline', 'ready', 'ready'), 'ready')
  assert.equal(assertTransition('timeline', 'exported', 'ready'), 'ready')
})

test('automated review and download recovery use explicit state-machine paths', () => {
  assert.equal(assertTransition('review', 'awaiting_human', 'automated_check'), 'automated_check')
  assert.equal(assertTransition('review', 'automated_check', 'awaiting_human'), 'awaiting_human')
  assert.equal(assertTransition('review', 'automated_check', 'rejected'), 'rejected')
  assert.equal(assertTransition('attempt', 'failed', 'downloading'), 'downloading')
})

test('invalidation is atomic when any dependent transition is illegal', () => {
  const project = {
    shots: { shot: { id: 'shot', status: 'ready', dependsOn: ['source'] } },
    assets: { asset: { id: 'asset', status: 'archived', dependsOn: ['source'] } },
    timelines: {}, deliverables: {},
  }
  assert.throws(() => invalidateDependents(project, ['source'], 'source changed'), /illegal asset transition/)
  assert.equal(project.shots.shot.status, 'ready')
  assert.equal(project.assets.asset.status, 'archived')
})

test('invalidation uses legal transitions and returns changed entities', () => {
  const project = {
    shots: { shot: { id: 'shot', status: 'ready', dependsOn: ['source'] } },
    assets: { asset: { id: 'asset', status: 'approved', dependsOn: ['shot'] } },
    timelines: {}, deliverables: {},
  }
  assert.deepEqual(invalidateDependents(project, ['source'], 'source changed'), ['shot', 'asset'])
  assert.equal(project.shots.shot.status, 'invalidated')
  assert.equal(project.assets.asset.status, 'invalidated')
})

test('invalidation depth limit prevents infinite loops', () => {
  // Build a circular dependency chain (A→B→C→A) by having each entity depend on the previous
  const project = { shots: {}, assets: {}, timelines: {}, deliverables: {} }
  const ids = []
  for (let i = 0; i < 150; i++) {
    const id = `asset-${i}`
    ids.push(id)
    project.assets[id] = { id, status: 'approved', dependsOn: i > 0 ? [`asset-${i - 1}`] : [] }
  }
  // This chain is 150 deep — should throw at depth 100
  assert.throws(() => collectDependents(project, ['asset-0']), /invalidation depth exceeded/)
})
