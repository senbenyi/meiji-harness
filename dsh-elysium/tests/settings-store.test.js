// 职责：验证设置单文件初始化、分区更新、锁冲突和敏感文件权限。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultSettings, withConfig } from '../src/config.js'
import { ensureSettings, readSettings, updateSettings } from '../src/database/managers/settings.js'
import { readRegistry, writeRegistry } from '../src/database/managers/registry.js'
import { readSelection, writeSelection } from '../src/database/managers/selection.js'
import { legacyTunnelBackend } from '../src/worker/models/catalog/servers.js'

const fixture = async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-unified-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, 'config'), providers = join(config, 'providers'), settings = join(config, 'settings.json')
  await mkdir(providers, { recursive: true })
  const registry = join(config, 'servers.json'), selection = join(config, 'selection.json')
  await writeFile(settings, '')
  await writeFile(registry, JSON.stringify({ version: 1, revision: 3, active: { video: 'video-a' }, third_party: { video: 'bailian:wan26' }, servers: [] }))
  await writeFile(selection, JSON.stringify({ version: 1, revision: 4, selected: {}, third_party: { video: 'bailian:wan26' } }))
  const bailian = join(providers, 'bailian.json')
  await writeFile(bailian, JSON.stringify({ enabled: true, base_url: 'https://example.test/api/v1', api_key: 'fixture-secret', video: {} }))
  return { root, settings, registry, selection, bailian }
}

test('empty settings imports every legacy section and stays private', async t => {
  const files = await fixture(t)
  const value = ensureSettings({ path: files.settings, defaults: defaultSettings, registryFile: files.registry, selectionFile: files.selection, providerFiles: { bailian: files.bailian } })
  assert.equal(value.connections.revision, 3)
  assert.equal(value.selection.revision, 4)
  assert.equal(value.selection.third_party.video, 'bailian:wan26')
  assert.equal(value.providers.bailian.api_key, 'fixture-secret')
  assert.equal((await stat(files.settings)).mode & 0o777, 0o600)
  assert.deepEqual(readSettings(files.settings), value)
})

test('registry and selection patch one file without losing the other section', async t => {
  const files = await fixture(t)
  ensureSettings({ path: files.settings, defaults: defaultSettings, registryFile: files.registry, selectionFile: files.selection, providerFiles: { bailian: files.bailian } })
  await withConfig({ ELYSIUM_SETTINGS_FILE: files.settings }, async () => {
    const registry = readRegistry(), selection = readSelection()
    await writeRegistry(registry, registry.revision)
    await writeSelection({ ...selection, selected: { video: 'video-a' } }, selection.revision)
  })
  const saved = readSettings(files.settings)
  assert.equal(saved.connections.revision, 4)
  assert.equal(saved.selection.revision, 5)
  assert.equal(saved.selection.selected.video, 'video-a')
  assert.equal(saved.providers.bailian.api_key, 'fixture-secret')
})

test('one settings lock rejects a competing section write without changing data', async t => {
  const files = await fixture(t)
  ensureSettings({ path: files.settings, defaults: defaultSettings, registryFile: files.registry, selectionFile: files.selection })
  const before = await readFile(files.settings, 'utf8'), lock = await open(`${files.settings}.lock`, 'wx', 0o600)
  try {
    await withConfig({ ELYSIUM_SETTINGS_FILE: files.settings }, async () => {
      const selection = readSelection()
      await assert.rejects(writeSelection(selection, selection.revision), error => error.status === 409)
    })
    assert.equal(await readFile(files.settings, 'utf8'), before)
  } finally {
    await lock.close()
    await rm(`${files.settings}.lock`)
  }
})

test('invalid unified settings never fall back to legacy files', async t => {
  const files = await fixture(t)
  await writeFile(files.settings, '{"version":1}')
  assert.throws(() => ensureSettings({ path: files.settings, defaults: defaultSettings, registryFile: files.registry }), /settings\.json/)
})

test('legacy atomic tool setting is accepted but removed from runtime settings', async t => {
  const files = await fixture(t)
  await writeFile(files.settings, JSON.stringify({ ...defaultSettings, enableAtomicTools: true }))
  const settings = readSettings(files.settings)
  assert.equal(Object.hasOwn(settings, 'enableAtomicTools'), false)
})

test('empty connection list keeps the configured chat SSH tunnel and API model', async t => {
  const files = await fixture(t)
  const defaults = structuredClone(defaultSettings)
  defaults.chat.tunnel.ssh_alias = 'localhost'
  ensureSettings({ path: files.settings, defaults, registryFile: files.registry, selectionFile: files.selection })
  const backend = withConfig({ ELYSIUM_SETTINGS_FILE: files.settings }, () => legacyTunnelBackend('qwen'))
  assert.equal(backend.connection.transport, 'ssh')
  assert.equal(backend.connection.model, 'qwen3.8-27b-elysium')
  assert.equal(backend.connection.api_key_env, undefined)
})

test('ComfyUI registry does not replace the configured chat SSH tunnel', async t => {
  const files = await fixture(t)
  const defaults = structuredClone(defaultSettings)
  defaults.chat.tunnel.ssh_alias = 'localhost'
  defaults.connections.servers.push({ id: 'comfy', label: 'ComfyUI', provider: 'autodl', connection_source: 'manual', instance_id: 'gpu', deployment_id: 'one', services: {
    comfyui: { transport: 'http', base_url: 'http://comfy.test', workload: 'minimax-h3' },
  } })
  ensureSettings({ path: files.settings, defaults, registryFile: files.registry, selectionFile: files.selection })
  const backend = withConfig({ ELYSIUM_SETTINGS_FILE: files.settings }, () => legacyTunnelBackend('qwen'))
  assert.equal(backend.server_id, 'legacy-qwen')
  assert.equal(backend.connection.ssh_alias, 'localhost')
  assert.equal(backend.connection.model, 'qwen3.8-27b-elysium')
})

test('legacy unified settings gains regular creation quality without losing sections', async t => {
  const files = await fixture(t), legacy = structuredClone(defaultSettings)
  delete legacy.creation
  await writeFile(files.settings, JSON.stringify(legacy), { mode: 0o600 })
  assert.deepEqual(readSettings(files.settings).creation, { revision: 0, quality: 'regular' })
  await updateSettings(files.settings, settings => ({ ...settings, creation: { revision: 1, quality: 'high' } }))
  const saved = readSettings(files.settings)
  assert.deepEqual(saved.creation, { revision: 1, quality: 'high' })
  assert.deepEqual(saved.models, legacy.models)
  assert.deepEqual(saved.chat, legacy.chat)
  assert.equal((await stat(files.settings)).mode & 0o777, 0o600)
})
