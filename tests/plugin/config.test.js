import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('配置优先级保持 env > 配置文件 > 默认值', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-svs-config-'))
  const path = join(dir, 'config.json')
  const keys = [
    'DSH_SVS_CONFIG',
    'DSH_SVS_COMFY_URL',
    'DSH_SVS_COMFY_KEY',
    'DSH_SVS_POLL_MS',
    'DSH_SVS_TIMEOUT_MS',
    'DSH_SVS_FLUX_MODEL',
  ]
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  try {
    writeFileSync(path, JSON.stringify({
      baseUrl: 'http://from-file:8188///',
      apiKey: 'file-key',
      pollMs: 3100,
      timeoutMs: 4200,
      canvasHome: 'sidebar',
      features: { promptSnapshots: false },
      models: { fluxUnet: 'file-flux.safetensors' },
      tiers: { 'image.text2image': { fast: 'file-fast' } },
    }))
    process.env.DSH_SVS_CONFIG = path
    for (const key of keys.slice(1)) delete process.env[key]

    const fileConfig = await import(`../../lib/config.js?file=${Date.now()}`)
    const fromFile = fileConfig.getCfg()
    assert.equal(fromFile.baseUrl, 'http://from-file:8188')
    assert.equal(fromFile.apiKey, 'file-key')
    assert.equal(fromFile.pollMs, 3100)
    assert.equal(fromFile.timeoutMs, 4200)
    assert.equal(fromFile.canvasHome, 'sidebar')
    assert.equal(fromFile.features.promptSnapshots, false)
    assert.equal(fromFile.features.workflowInspector, true)
    assert.equal(fromFile.models.fluxUnet, 'file-flux.safetensors')
    assert.deepEqual(fromFile.tiers, { 'image.text2image': { fast: 'file-fast' } })

    process.env.DSH_SVS_COMFY_URL = 'http://from-env:9000/'
    process.env.DSH_SVS_COMFY_KEY = 'env-key'
    process.env.DSH_SVS_POLL_MS = '5100'
    process.env.DSH_SVS_TIMEOUT_MS = '6200'
    process.env.DSH_SVS_FLUX_MODEL = 'env-flux.safetensors'
    const envConfig = fileConfig.getCfg()
    assert.equal(envConfig.baseUrl, 'http://from-env:9000')
    assert.equal(envConfig.apiKey, 'env-key')
    assert.equal(envConfig.pollMs, 5100)
    assert.equal(envConfig.timeoutMs, 6200)
    assert.equal(envConfig.models.fluxUnet, 'env-flux.safetensors')
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
