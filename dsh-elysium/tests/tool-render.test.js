import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToolDebug } from '../src/tools/output.js'

test('default output keeps delivery and failure evidence without duplicating prompts or trace', () => {
  const value = { job_id: 'a'.repeat(32), status: 'failed', failed_stage: 'generate',
    error_code: 'FAILED', error: 'node failed', retryable: null, retry_scope: 'manual',
    debug: { effective_input: { prompt: 'private creative input'.repeat(1000) },
      chain: [{ parameters: 'large trace'.repeat(1000) }], diagnostic_path: '/jobs/diagnostic.json',
      log_path: '/jobs/execution.log', node_errors: [{ node_id: 'sample', error: 'invalid' }] } }
  const rendered = renderToolDebug({ prompt: 'not echoed' }, value)[0].text
  const summary = JSON.parse(rendered)
  assert.equal(summary.retryable, null)
  assert.equal(summary.failed_stage, 'generate')
  assert.equal(summary.error_code, 'FAILED')
  assert.deepEqual(summary.node_errors, value.debug.node_errors)
  assert.equal(summary.diagnostic_path, value.debug.diagnostic_path)
  assert.ok(rendered.length < JSON.stringify(value).length / 10)
  assert.ok(!rendered.includes('private creative input'))
  assert.deepEqual(JSON.parse(renderToolDebug({ detail: true }, value)[0].text), value)
})

test('completed output preserves actual media and review status', () => {
  const value = { job_id: 'b'.repeat(32), status: 'succeeded', path: '/output/final.mp4',
    media_info: { duration_seconds: 10.125, width: 640, height: 384 },
    validation: { full_decode: 'passed', human_review: 'not_run' }, warnings: ['review pending'] }
  assert.deepEqual(JSON.parse(renderToolDebug({}, value)[0].text), value)
})

test('image result retains the exact local reference path alongside its preview', () => {
  const value = { status: 'succeeded', job_id: 'c'.repeat(32), media_kind: 'image',
    path: '/artifacts/image.png', comfyui_metadata_status: 'comfyui-final', comfyui_view_url: 'http://comfy/view?filename=image.png' }
  const output = JSON.parse(renderToolDebug({}, value)[0].text)
  assert.equal(output.path, value.path)
  assert.equal(output.comfyui_view_url, value.comfyui_view_url)
})
