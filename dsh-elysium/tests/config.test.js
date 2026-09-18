import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { defaultSettings, readDefaults, requiredConfig, resolveConfig, withConfig, workerEnvironment } from '../src/config.js'
import { comfyUrl, ComfyClient } from '../src/models/protocols/comfyui/client.js'

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
  const root = await mkdtemp(join(tmpdir(), 'elysium-preference-only-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const defaultHome = join(root, 'default-home')
  assert.equal(resolveConfig({ home: defaultHome, comfyUrl: 'https://pod.test' }).ELYSIUM_STATE_ROOT, defaultHome)
  for (const config of [{ comfyUrl: 'ftp://host' }, { publicUrl: 'https://duplicate.test' }, { bailianFile: 'relative' },
    { artifactsRoot: '/obsolete' }, { stateRoot: 'relative' }, { ffprobe: 12 }, { enableAtomicTools: true }, { typo: '/path' }]) assert.throws(() => resolveConfig({ home: join(root, 'invalid'), ...config }))
  const homes = [join(root, 'instance-a'), join(root, 'instance-b')]
  const configs = homes.map((stateRoot, index) => resolveConfig({
    home: stateRoot, comfyUrl: `https://pod-${index}.test`, stateRoot, bailianFile: join(stateRoot, 'bailian.json'),
  }))
  assert.deepEqual(await Promise.all(configs.map(config => withConfig(config, async () => {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(workerEnvironment().ELYSIUM_SETTINGS_FILE, config.ELYSIUM_SETTINGS_FILE)
    return [requiredConfig('COMFYUI_URL', 'url'), requiredConfig('ELYSIUM_STATE_ROOT')]
  }))), [['https://pod-0.test', homes[0]], ['https://pod-1.test', homes[1]]])
  const serversFile = join(root, 'servers.json')
  await writeFile(serversFile, JSON.stringify({ version: 1, revision: 1, active: {}, third_party: { video: 'byteplus:seedance2' }, servers: [] }))
  assert.equal(resolveConfig({ home: root, settingsFile: join(root, 'settings.json'), serversFile, comfyUrl: 'https://legacy.test' }).COMFYUI_URL, 'https://legacy.test')
})

test('repository defaults initialize the single runtime settings file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-settings-')); t.after(() => rm(root, { recursive: true, force: true }))
  const defaults = resolveConfig({ home: root }).ELYSIUM_MODELS, models = { image: [], video: [] }
  assert.deepEqual(defaults, defaultSettings.models)
  assert.deepEqual(resolveConfig({ home: root, models }).ELYSIUM_MODELS, models)
  assert.deepEqual(resolveConfig({ home: root, models: { ...models, llm: [{ id: 'old', label: '旧文本模型' }], analysis: [] } }).ELYSIUM_MODELS, models)
  assert.throws(() => resolveConfig({ home: root, models: { ...models, analysis: 'bad' } }))
  const config = resolveConfig({ home: root })
  assert.equal(config.ELYSIUM_SETTINGS_FILE, join(root, 'config', 'settings.json'))
  assert.equal(config.ELYSIUM_SERVERS_FILE, undefined)
  assert.equal(config.ELYSIUM_CONFIG_FILE, undefined)
  assert.equal(config.ELYSIUM_BYTEPLUS_FILE, undefined)
  assert.equal(config.ELYSIUM_BAILIAN_FILE, undefined)
  withConfig(config, () => assert.equal(workerEnvironment().ELYSIUM_HOME, root))
  const file = join(root, 'defaults.json')
  await writeFile(file, JSON.stringify({ ...defaultSettings, extra: true }))
  assert.throws(() => readDefaults(file), /配置无效/)
  await writeFile(file, JSON.stringify({ ...defaultSettings, models: { image: [], video: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] } }))
  assert.throws(() => readDefaults(file), /模型配置项无效/)
})
