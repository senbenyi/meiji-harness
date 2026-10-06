import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveRunStatus, readySteps, validateRun } from '../shared/run-model.js'

const step = (id, status = 'pending', after = []) => ({ id, key: `generate@${id}`, kind: 'generate', target: id, status, after, scope: 'episode', queue: 'text' })
const run = (steps, events = [{ type: 'confirmed' }]) => ({ schemaVersion: 1, id: 'run', projectId: 'project', episodeId: 'episode', steps, events, pause: null })

test('Run 状态由确认、暂停原因与有效步骤推导，不把取消当作完成', () => {
  assert.equal(deriveRunStatus(run([], [])), 'draft')
  assert.equal(deriveRunStatus(run([])), 'completed')
  assert.equal(deriveRunStatus(run([step('a', 'ready')])), 'running')
  assert.equal(deriveRunStatus(run([step('a', 'paused'), step('b', 'running')])), 'paused')
  assert.equal(deriveRunStatus(run([step('a', 'done'), step('b', 'superseded')])), 'completed')
  assert.equal(deriveRunStatus(run([step('a', 'cancelled')])), 'cancelled')
  assert.equal(deriveRunStatus(run([step('a', 'pending')], [{ type: 'cancelled' }])), 'cancelled')
  assert.equal(deriveRunStatus({ ...run([step('a', 'done')]), pause: { reasons: [{ code: 'user_paused' }] } }), 'paused')
})

test('暂停一条分支不会阻止独立分支；依赖缺失、作废或取消不能就绪', () => {
  const value = run([step('a', 'paused'), step('b'), step('c', 'pending', ['a']), step('d', 'pending', ['missing'])])
  assert.deepEqual(readySteps(value).map(item => item.id), ['b'])
  value.pause = { reasons: [{ code: 'user_paused' }] }
  assert.deepEqual(readySteps(value), [])
  assert.deepEqual(readySteps(run([step('a', 'cancelled'), step('b', 'pending', ['a'])])), [])
  assert.deepEqual(readySteps(run([step('a', 'skipped'), step('b', 'pending', ['a'])])).map(item => item.id), ['b'])
  assert.deepEqual(readySteps(run([step('a')], [])), [])
})

test('非法步骤图在执行前拒绝，包括重复、缺依赖、环与未改接的作废依赖', () => {
  assert.throws(() => validateRun(run([step('a'), step('a')])), /重复/)
  assert.throws(() => validateRun(run([step('a', 'pending', ['b'])])), /不存在/)
  assert.throws(() => validateRun(run([step('a', 'pending', ['b']), step('b', 'pending', ['a'])])), /有环/)
  assert.throws(() => validateRun(run([step('a', 'superseded'), step('b', 'pending', ['a'])])), /作废/)
  assert.throws(() => validateRun({ ...run([step('a')]), episodeId: null }), /范围/)
  assert.equal(validateRun(run([step('a'), step('b', 'pending', ['a'])])).id, 'run')
})
