import test from 'node:test'
import assert from 'node:assert/strict'
import { attemptDiagnostics, recoveryPlan } from '../../lib/media/recovery.js'
import { classifyGenerationFailure } from '../../lib/media/failures.js'

test('unknown submission is never automatically retried', () => {
  const attempt = { id: 'a1', status: 'submission_unknown', error: 'network lost' }
  const diagnostics = attemptDiagnostics(attempt)
  assert.equal(diagnostics.recommendedAction, 'confirm_external')
  assert.equal(diagnostics.duplicateChargeRisk, 'high')
  assert.equal(diagnostics.automatic, false)
  assert.equal(recoveryPlan({ attempts: { a1: attempt } })[0].action, 'confirm-external')
})

test('download failures are recoverable without another provider submission', () => {
  const attempt = { id: 'a1', status: 'failed', promptId: 'p1', failureClass: 'download_failure', retryable: true }
  const diagnostics = attemptDiagnostics(attempt)
  assert.equal(diagnostics.recoveryState, 'retry_download')
  assert.equal(diagnostics.duplicateChargeRisk, 'none')
})

test('failure classifier distinguishes known rejection from uncertain network submission', () => {
  assert.deepEqual(classifyGenerationFailure(new Error('workflow-validation: 400 invalid node'), { stage: 'submit' }).submissionUncertain, false)
  assert.deepEqual(classifyGenerationFailure(new Error('comfy-unreachable: fetch failed'), { stage: 'submit' }).submissionUncertain, true)
  assert.equal(classifyGenerationFailure(new Error('comfy-download-failed: 500')).failureClass, 'download_failure')
})
