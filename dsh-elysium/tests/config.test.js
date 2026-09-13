import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requiredConfig } from '../src/config.js'
import { comfyUrl, ComfyClient } from '../src/comfyui/client.js'

test('missing, empty and invalid addresses fail before any request; removed instance is rejected', () => {
  const previous = process.env.COMFYUI_URL
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => { calls++; throw new Error('unexpected request') }
  try {
    delete process.env.COMFYUI_URL
    assert.throws(() => new ComfyClient(), /COMFYUI_URL/)
    for (const value of ['', ' ', 'ftp://comfy.test', 'http://user:pass@comfy.test', 'http://comfy.test:99999', 'http://comfy.test/?key=secret']) {
      process.env.COMFYUI_URL = value
      assert.throws(() => new ComfyClient(), /COMFYUI_URL/)
    }
    process.env.COMFYUI_URL = 'https://comfy.test:19443/backend/'
    assert.equal(comfyUrl(), 'https://comfy.test:19443/backend')
    assert.equal(new ComfyClient().url.href, 'https://comfy.test:19443/backend/')
    assert.throws(() => comfyUrl('production'), /未知 ComfyUI/)
    assert.throws(() => comfyUrl('typo'), /未知 ComfyUI/)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.COMFYUI_URL
    else process.env.COMFYUI_URL = previous
  }
})

test('storage configuration rejects absent, empty and relative paths', () => {
  const previous = process.env.ELYSIUM_STATE_ROOT
  try {
    delete process.env.ELYSIUM_STATE_ROOT
    assert.throws(() => requiredConfig('ELYSIUM_STATE_ROOT'), /ELYSIUM_STATE_ROOT/)
    for (const value of ['', 'relative/path']) {
      process.env.ELYSIUM_STATE_ROOT = value
      assert.throws(() => requiredConfig('ELYSIUM_STATE_ROOT'), /ELYSIUM_STATE_ROOT/)
    }
    process.env.ELYSIUM_STATE_ROOT = '/configured/tasks'
    assert.equal(requiredConfig('ELYSIUM_STATE_ROOT'), '/configured/tasks')
  } finally {
    if (previous === undefined) delete process.env.ELYSIUM_STATE_ROOT
    else process.env.ELYSIUM_STATE_ROOT = previous
  }
})
