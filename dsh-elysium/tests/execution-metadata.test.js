import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeVersion, traceDiagnostics } from '../src/server/jobs/diagnostics.js'
import { createTiming } from '../src/server/jobs/timing.js'
import { waitJob } from '../src/server/jobs/wait.js'

test('execution metadata preserves fingerprint, prompt errors and monotonic timing', async t => {
  assert.match((await codeVersion()).executor_sha256, /^[0-9a-f]{64}$/)
  const chain = [
    { stage: 'route', span_id: 's1', capability: 'text-to-video', timestamp: '2026-09-06T00:00:00Z' },
    { stage: 'comfyui-status', span_id: 's1', prompt_id: 'p1', timestamp: '2026-09-06T00:00:03Z', node_errors: [{ node_id: '7' }] },
  ]
  assert.equal(traceDiagnostics(chain).stage_timings[0].recorded_duration_ms, 3000)
  assert.deepEqual(traceDiagnostics(chain).node_errors, [{ node_id: '7' }])
  const timing = createTiming(), error = new Error('request failed')
  t.mock.method(Date, 'now', () => -1e15)
  await assert.rejects(timing.measure('request', async () => { throw error }), value => value === error)
  assert.equal(timing.snapshot().stages.request.failed, 1)
})

test('local wait records reads and sleep before returning completion', async () => {
  const timing = createTiming()
  let reads = 0, sleeps = 0
  const result = await waitJob({ job_id: 'job' }, undefined, async () => ++reads === 1
    ? { status: 'running' } : { status: 'succeeded', result: { comfyui_view_url: 'https://server/video' } }, async ms => {
    assert.equal(ms, 2000); sleeps++
  }, timing)
  assert.equal(result.comfyui_view_url, 'https://server/video')
  assert.equal(sleeps, 1)
  assert.equal(timing.snapshot().stages['local.read-status'].count, 2)
})
