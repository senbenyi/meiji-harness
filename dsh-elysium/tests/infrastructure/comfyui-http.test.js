import assert from 'node:assert/strict'
import test from 'node:test'
import { uploadImage } from '../../src/infrastructure/comfyui/http.js'
import { waitForJob } from '../../src/infrastructure/comfyui/engine.js'

test('ComfyUI image uploads allow slow remote GPU cleanup', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  let timeout

  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
  globalThis.setTimeout = (callback, delay) => {
    timeout = delay
    queueMicrotask(callback)
    return 1
  }
  globalThis.clearTimeout = () => {}

  try {
    await assert.rejects(uploadImage('http://127.0.0.1:8189', '', Buffer.from('image'), 'frame.png'), /TIMEOUT POST \/upload\/image/)
    assert.equal(timeout, 300_000)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})

test('ComfyUI history polling tolerates GPU-blocked HTTP responses', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  let timeout

  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
  globalThis.setTimeout = (callback, delay) => {
    timeout = delay
    queueMicrotask(callback)
    return 1
  }
  globalThis.clearTimeout = () => {}

  try {
    await assert.rejects(waitForJob({ baseUrl: 'http://127.0.0.1:8189', outputDir: '/tmp', promptId: 'job-1', waitS: 1 }), /TIMEOUT GET \/history\/job-1/)
    assert.equal(timeout, 300_000)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})
