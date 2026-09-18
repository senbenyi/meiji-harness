import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRuntimeTools } from '../src/tools/index.js'

const tools = new Map(createRuntimeTools({}).map(tool => [tool.name, tool]))
const renderWorkcard = (args, value) => tools.get('call_tools_job_status').output.render(args, value)
const workcard = JSON.parse(readFileSync(new URL('../config/workcard.json', import.meta.url), 'utf8'))

test('default output keeps delivery and failure evidence without duplicating prompts or trace', () => {
  const value = { job_id: 'a'.repeat(32), status: 'failed', failed_stage: 'generate',
    error_code: 'FAILED', error: 'node failed', retryable: null, retry_scope: 'manual',
    debug: { effective_input: { prompt: 'private creative input'.repeat(1000) },
      chain: [{ parameters: 'large trace'.repeat(1000) }], diagnostic_path: '/jobs/diagnostic.json',
      log_path: '/jobs/execution.log', node_errors: [{ node_id: 'sample', error: 'invalid' }] } }
  const rendered = renderWorkcard({ prompt: 'not echoed' }, value)[0].text
  const summary = JSON.parse(rendered)
  assert.equal(summary.retryable, null)
  assert.equal(summary.failed_stage, 'generate')
  assert.equal(summary.error_code, 'FAILED')
  assert.deepEqual(summary.node_errors, value.debug.node_errors)
  assert.equal(summary.diagnostic_path, value.debug.diagnostic_path)
  assert.ok(rendered.length < JSON.stringify(value).length / 10)
  assert.ok(!rendered.includes('private creative input'))
  assert.deepEqual(JSON.parse(renderWorkcard({ detail: true }, value)[0].text), value)
})

test('completed output preserves actual media and review status', () => {
  const value = { project_id: '1234abcd', job_id: 'b'.repeat(32), status: 'succeeded',
    comfyui_metadata_status: 'comfyui-final', comfyui_view_url: 'http://comfy/view?filename=final.mp4',
    validation: { full_decode: 'passed', human_review: 'not_run' }, warnings: ['review pending'] }
  assert.deepEqual(JSON.parse(renderWorkcard({}, value)[0].text), {
    project_id: value.project_id, job_id: value.job_id, status: value.status, comfyui_view_url: value.comfyui_view_url,
    validation: value.validation, warnings: value.warnings,
  })
})

test('image result exposes only its server preview URL', () => {
  const value = { status: 'succeeded', job_id: 'c'.repeat(32), media_kind: 'image',
    comfyui_metadata_status: 'comfyui-final', comfyui_view_url: 'http://comfy/view?filename=image.png' }
  const output = JSON.parse(renderWorkcard({}, value)[0].text)
  assert.equal(output.comfyui_view_url, value.comfyui_view_url)
  assert.ok(!Object.hasOwn(output, 'path'))
})

test('failed provider output identifies the configured model', () => {
  const value = { job_id: 'd'.repeat(32), status: 'failed', error: 'worker stopped',
    debug: { effective_input: { mode: 't2va' } },
    server: { server_id: 'bailian', provider: 'bailian', connection: { text_model: 'wan2.6-t2v', image_model: 'wan2.6-i2v' } } }
  assert.deepEqual(JSON.parse(renderWorkcard({}, value)[0].text).server,
    { server_id: 'bailian', provider: 'bailian', model: 'wan2.6-t2v' })
})

test('runtime tools receive their output schemas from workcard config', () => {
  for (const [name, schema] of Object.entries(workcard.tools)) assert.deepEqual(tools.get(name).output.schema, workcard.schemas[schema])
})
