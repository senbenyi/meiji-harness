import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig, withConfig, requiredConfig, workerEnvironment } from '../src/config.js'

for (const key of ['COMFYUI_URL', 'ELYSIUM_STATE_ROOT']) delete process.env[key]

test('plugin config uses one ComfyUI URL and isolates concurrent calls', async () => {
  assert.equal(resolveConfig({ comfyUrl: 'https://pod.test' }).ELYSIUM_STATE_ROOT, join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'elysium'))
  for (const config of [{ comfyUrl: 'ftp://host' }, { publicUrl: 'https://duplicate.test' },
    { bailianFile: 'relative' }, { artifactsRoot: '/obsolete' }, { stateRoot: 'relative' }, { ffprobe: 12 },
    { enableAtomicTools: '1' }, { typo: '/path' }]) assert.throws(() => resolveConfig(config))
  const configs = ['/tmp/instance-a', '/tmp/instance-b'].map((stateRoot, index) => resolveConfig({
    comfyUrl: `https://pod-${index}.test`, stateRoot, bailianFile: join(stateRoot, 'bailian.json'),
  }))
  const values = await Promise.all(configs.map(config => withConfig(config, async () => {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(workerEnvironment().COMFYUI_URL, config.COMFYUI_URL)
    assert.equal(workerEnvironment().ELYSIUM_BAILIAN_FILE, config.ELYSIUM_BAILIAN_FILE)
    return [requiredConfig('COMFYUI_URL', 'url'), requiredConfig('ELYSIUM_STATE_ROOT')]
  })))
  assert.deepEqual(values, [['https://pod-0.test', '/tmp/instance-a'], ['https://pod-1.test', '/tmp/instance-b']])
  assert.equal(process.env.COMFYUI_URL, undefined)
})

// 分析模型默认复用 Qwen 清单，兼容已有三类模型配置。
test('analysis defaults to Qwen and accepts an independent fixed catalog', () => {
  const defaults = resolveConfig().ELYSIUM_MODELS
  assert.deepEqual(defaults.analysis, defaults.llm)
  const models = { llm: [], image: [], video: [] }
  assert.deepEqual(resolveConfig({ models }).ELYSIUM_MODELS.analysis, defaults.analysis)
  assert.deepEqual(resolveConfig({ models: { ...models, analysis: [] } }).ELYSIUM_MODELS.analysis, [])
  assert.throws(() => resolveConfig({ models: { ...models, analysis: 'bad' } }))
})
