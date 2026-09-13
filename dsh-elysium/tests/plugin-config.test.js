import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveConfig, withConfig, requiredConfig, workerEnvironment } from '../src/config.js'

for (const key of ['COMFYUI_URL', 'ELYSIUM_STATE_ROOT']) delete process.env[key]

test('plugin config uses one ComfyUI URL and isolates concurrent calls', async () => {
  for (const config of [{ comfyUrl: 'ftp://host' }, { publicUrl: 'https://duplicate.test' },
    { artifactsRoot: '/obsolete' }, { stateRoot: 'relative' }, { ffprobe: 12 },
    { enableAtomicTools: '1' }, { typo: '/path' }]) assert.throws(() => resolveConfig(config))
  const configs = ['/tmp/instance-a', '/tmp/instance-b'].map((stateRoot, index) => resolveConfig({
    comfyUrl: `https://pod-${index}.test`, stateRoot,
  }))
  const values = await Promise.all(configs.map(config => withConfig(config, async () => {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(workerEnvironment().COMFYUI_URL, config.COMFYUI_URL)
    return [requiredConfig('COMFYUI_URL', 'url'), requiredConfig('ELYSIUM_STATE_ROOT')]
  })))
  assert.deepEqual(values, [['https://pod-0.test', '/tmp/instance-a'], ['https://pod-1.test', '/tmp/instance-b']])
  assert.equal(process.env.COMFYUI_URL, undefined)
})
