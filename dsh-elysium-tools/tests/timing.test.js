import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTiming } from '../src/jobs/timing.js'
import { waitJob } from '../src/jobs/wait.js'

test('wall clock changes do not affect duration and failed calls retain timing', async t => {
  const timing = createTiming(), error = new Error('request failed')
  t.mock.method(Date, 'now', () => -1e15)
  await assert.rejects(timing.measure('request', async () => { throw error }), e => e === error)
  const snapshot = timing.snapshot()
  assert.equal(snapshot.stages.request.failed, 1)
  assert.ok(snapshot.total_ms >= snapshot.stages.request.total_ms)
  assert.ok(snapshot.total_ms < 1000)
})

test('local completion returns immediately and waiting records the unchanged interval', async () => {
  const timing = createTiming()
  let reads = 0, sleeps = 0
  const result = await waitJob({ job_id: 'job' }, undefined, async () => ++reads === 1
    ? { status: 'running' } : { status: 'succeeded', result: { path: 'https://server/video' } }, async ms => {
    assert.equal(ms, 2000)
    sleeps++
  }, timing)
  assert.equal(result.path, 'https://server/video')
  assert.equal(sleeps, 1)
  assert.equal(timing.snapshot().stages['local.read-status'].count, 2)
  assert.equal(timing.snapshot().stages['local.sleep'].count, 1)
})
