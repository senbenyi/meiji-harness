import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeVersion, traceDiagnostics } from '../src/worker/results/diagnostics.js'
import { waitJob } from '../src/worker/runner/wait.js'

test('execution metadata preserves fingerprint and prompt errors', async () => {
  assert.match((await codeVersion()).executor_sha256, /^[0-9a-f]{64}$/)
  const chain = [
    { stage: 'route', span_id: 's1', capability: 'text-to-video', timestamp: '2026-09-06T00:00:00Z' },
    { stage: 'comfyui-status', span_id: 's1', prompt_id: 'p1', timestamp: '2026-09-06T00:00:03Z', node_errors: [{ node_id: '7' }] },
  ]
  assert.equal(traceDiagnostics(chain).stage_timings[0].recorded_duration_ms, 3000)
  assert.deepEqual(traceDiagnostics(chain).node_errors, [{ node_id: '7' }])
})

test('local wait reads and sleeps before returning completion', async () => {
  let reads = 0, sleeps = 0
  const result = await waitJob({ job_id: 'job' }, undefined, async () => ++reads === 1
    ? { status: 'running' } : { job_id: 'job', project_id: '00000000', status: 'succeeded',
      result: { path: 'https://server/video', comfyui_view_url: 'https://server/video', specification: { seconds: 8 } } }, async ms => {
    assert.equal(ms, 2000); sleeps++
  })
  assert.deepEqual(result, { job_id: 'job', status: 'succeeded', path: 'https://server/video',
    comfyui_view_url: 'https://server/video', specification: { seconds: 8 } })
  assert.ok(!Object.hasOwn(result, 'project_id'))
  assert.equal(reads, 2)
  assert.equal(sleeps, 1)
})
