import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { defaultSettings, readSettings, requiredConfig, resolveConfig, withConfig, workerEnvironment } from '../src/config.js'
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

test('plugin config validates fields and isolates concurrent calls', async t => {
  assert.equal(resolveConfig({ comfyUrl: 'https://pod.test' }).ELYSIUM_STATE_ROOT, join(homedir(), '.elysium'))
  for (const config of [{ comfyUrl: 'ftp://host' }, { publicUrl: 'https://duplicate.test' }, { bailianFile: 'relative' },
    { artifactsRoot: '/obsolete' }, { stateRoot: 'relative' }, { ffprobe: 12 }, { enableAtomicTools: '1' }, { typo: '/path' }]) assert.throws(() => resolveConfig(config))
  const configs = ['/tmp/instance-a', '/tmp/instance-b'].map((stateRoot, index) => resolveConfig({
    comfyUrl: `https://pod-${index}.test`, stateRoot, bailianFile: join(stateRoot, 'bailian.json'),
  }))
  assert.deepEqual(await Promise.all(configs.map(config => withConfig(config, async () => {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(workerEnvironment().ELYSIUM_BAILIAN_FILE, config.ELYSIUM_BAILIAN_FILE)
    return [requiredConfig('COMFYUI_URL', 'url'), requiredConfig('ELYSIUM_STATE_ROOT')]
  }))), [['https://pod-0.test', '/tmp/instance-a'], ['https://pod-1.test', '/tmp/instance-b']])
  const root = await mkdtemp(join(tmpdir(), 'elysium-preference-only-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const serversFile = join(root, 'servers.json')
  await writeFile(serversFile, JSON.stringify({ version: 1, revision: 1, active: {}, third_party: { video: 'byteplus:seedance2' }, servers: [] }))
  assert.equal(resolveConfig({ serversFile, comfyUrl: 'https://legacy.test' }).COMFYUI_URL, 'https://legacy.test')
})

test('repository settings provide model defaults and independent provider paths', async t => {
  const defaults = resolveConfig().ELYSIUM_MODELS, models = { image: [], video: [] }
  assert.deepEqual(defaults, defaultSettings.models)
  assert.deepEqual(resolveConfig({ models }).ELYSIUM_MODELS, models)
  assert.throws(() => resolveConfig({ models: { ...models, analysis: [] } }))
  const config = resolveConfig({ home: '/tmp/elysium-home' })
  assert.equal(config.ELYSIUM_BYTEPLUS_FILE, '/tmp/elysium-home/providers/byteplus.json')
  assert.equal(config.ELYSIUM_BAILIAN_FILE, '/tmp/elysium-home/providers/bailian.json')
  withConfig(config, () => assert.equal(workerEnvironment().ELYSIUM_HOME, '/tmp/elysium-home'))
  const root = await mkdtemp(join(tmpdir(), 'elysium-settings-')); t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'settings.json')
  await writeFile(file, JSON.stringify({ ...defaultSettings, paths: { ...defaultSettings.paths, providers: '../outside' } }))
  assert.throws(() => readSettings(file), /路径无效/)
  await writeFile(file, JSON.stringify({ ...defaultSettings, models: { image: [], video: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] } }))
  assert.throws(() => readSettings(file), /模型配置项无效/)
})
