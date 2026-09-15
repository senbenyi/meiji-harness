import assert from 'node:assert/strict'
import test from 'node:test'
import { codeVersion, traceDiagnostics } from '../src/business/jobs/diagnostics.js'

test('execution fingerprint includes the current execution modules', async () => {
  assert.match((await codeVersion()).executor_sha256, /^[0-9a-f]{64}$/)
})

test('stage timing preserves existing prompt evidence', () => {
  const chain = [
    { stage: 'route', span_id: 's1', capability: 'text-to-video', timestamp: '2026-09-06T00:00:00Z' },
    { stage: 'comfyui-status', span_id: 's1', prompt_id: 'p1', timestamp: '2026-09-06T00:00:03Z', node_errors: [{ node_id: '7' }] },
  ]
  assert.equal(traceDiagnostics(chain).stage_timings[0].recorded_duration_ms, 3000)
  assert.deepEqual(traceDiagnostics(chain).node_errors, [{ node_id: '7' }])
})
