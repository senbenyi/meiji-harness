import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createModelApiService, createModelGenerateImageTool } from '../src/index.js'

test('submits image parameters and returns the completed artifact', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (calls.length === 1) {
      return new Response(JSON.stringify({ job_id: 'a'.repeat(32), status: 'queued' }), { status: 202 })
    }
    return new Response(JSON.stringify({
      job_id: 'a'.repeat(32),
      status: 'succeeded',
      result: { path: '/root/autodl-fs/artifacts/projects/api-a/img.png', size_bytes: 123, sha256: 'b'.repeat(64) },
    }))
  }

  const result = await createModelApiService().generateImage({ prompt: '  cinematic portrait  ' })

  assert.equal(calls[0].url, 'http://127.0.0.1:8010/v1/images/generations')
  assert.deepEqual(JSON.parse(calls[0].options.body), { prompt: 'cinematic portrait', preset: 'standard', seed: 666 })
  assert.equal(calls[1].url, `http://127.0.0.1:8010/v1/jobs/${'a'.repeat(32)}`)
  assert.deepEqual(result, {
    job_id: 'a'.repeat(32), status: 'succeeded',
    path: '/root/autodl-fs/artifacts/projects/api-a/img.png', size_bytes: 123, sha256: 'b'.repeat(64),
  })
})

test('defines only model_generate_image in the independent manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  const tool = createModelGenerateImageTool({ generateImage: async () => ({}) })
  assert.equal(tool.name, 'model_generate_image')
  assert.deepEqual(manifest.contributes.tools, ['model_generate_image'])
})

test('surfaces a failed Model API job', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return new Response(JSON.stringify({ job_id: 'c'.repeat(32), status: 'queued' }), { status: 202 })
    return new Response(JSON.stringify({ job_id: 'c'.repeat(32), status: 'failed', error: '输出未通过健康闸门' }))
  }
  await assert.rejects(
    createModelApiService().generateImage({ prompt: 'test' }),
    error => error.code === 'MODEL_GENERATION_FAILED' && /健康闸门/.test(error.message),
  )
})

test('rejects an invalid preset before calling Model API', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => { throw new Error('fetch must not be called') }
  await assert.rejects(
    createModelApiService().generateImage({ prompt: 'test', preset: 'unknown' }),
    error => error.code === 'VALIDATION_ERROR' && /preset/.test(error.message),
  )
})
