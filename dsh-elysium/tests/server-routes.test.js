// 职责：验证服务器端点认证、脱敏、版本冲突、失败回执和停用边界。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings, withConfig } from '../src/config.js'
import { createSettingsHandler, SETTINGS_ROUTE } from '../src/server/routes/settings.js'
const record = id => ({ id, label: id, provider: 'runpod', connection_source: 'manual', instance_id: id, deployment_id: 'one', services: { comfyui: { transport: 'http', base_url: `http://${id}.test`, workload: 'minimax-h3' } } })
test('all endpoints authenticate before IO; registration stays manual and switching is checked', async t => {
  const root = await mkdtemp(join(tmpdir(), 'server-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let fail = false, calls = 0
  const handler = createSettingsHandler({ token: 'test', check: async () => { calls++; if (fail) throw new Error('PRIVATE_API_KEY=secret'); return { ok: true } } })
  const server = createServer((req, res) => withConfig({ ELYSIUM_SERVERS_FILE: join(root, 'servers.json'), ELYSIUM_CONFIG_FILE: join(root, 'config.json') }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (action, body, token = 'test') => fetch(`http://127.0.0.1:${server.address().port}${SETTINGS_ROUTE}/${action}?t=${token}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  for (const action of ['list', 'register', 'check', 'switch', 'set-enabled', 'model-select', 'third-party-select', 'creation-quality']) assert.equal((await request(action, action === 'list' ? null : {}, 'bad')).status, 401)
  assert.equal(calls, 0)
  assert.equal((await request('register', { revision: 0, server: { ...record('autodl'), provider: 'autodl' } })).status, 201)
  assert.equal((await request('register', { revision: 1, server: record('a') })).status, 201)
  assert.equal((await request('register', { revision: 2, server: record('b') })).status, 201)
  assert.equal((await request('register', { revision: 2, server: record('c') })).status, 409)
  const listed = await (await request('list')).json()
  assert.equal(listed.providers.find(provider => provider.id === 'runpod').available, true)
  assert.equal(listed.providers.find(provider => provider.id === 'autodl').available, true)
  assert.equal(listed.selection_revision, 0); assert.equal(listed.servers.length, 3)
  assert.doesNotMatch(JSON.stringify(listed), /base_url|instance_id|ssh_identity|api_key/)
  assert.equal((await request('switch', { id: 'a', service: 'comfyui', selection_revision: 0, revision: 3 })).status, 200)
  fail = true
  const failed = await request('switch', { id: 'b', service: 'comfyui', selection_revision: 1, revision: 3 })
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /PRIVATE|secret/)
  assert.equal((await (await request('list')).json()).selection_revision, 1)
  assert.equal((await request('set-enabled', { id: 'a', enabled: false, revision: 3 })).status, 400)
  assert.equal((await request('set-enabled', { id: 'b', enabled: false, revision: 3 })).status, 200)
  assert.equal((await request('check', { id: 'b', service: 'comfyui' })).status, 400)
  assert.equal((await request('delete', { id: 'a', revision: 5 })).status, 404)
})

test('creation quality uses its own revision and persists only valid global values', async t => {
  const root = await mkdtemp(join(tmpdir(), 'creation-quality-http-')), settings = join(root, 'settings.json')
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(settings, JSON.stringify(defaultSettings), { mode: 0o600 })
  const config = { ELYSIUM_SETTINGS_FILE: settings, ELYSIUM_MODELS: defaultSettings.models }
  const handler = createSettingsHandler({ token: 'test' })
  const server = createServer((req, res) => withConfig(config, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = body => fetch(`http://127.0.0.1:${server.address().port}${SETTINGS_ROUTE}/creation-quality?t=test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await request({ quality: 'high', revision: 0 })).status, 200)
  assert.equal((await request({ quality: 'fast', revision: 0 })).status, 409)
  assert.equal((await request({ quality: 'unknown', revision: 1 })).status, 400)
  const models = await (await fetch(`http://127.0.0.1:${server.address().port}${SETTINGS_ROUTE}/models?t=test`)).json()
  assert.deepEqual(models.creation, { quality: 'high', revision: 1 })
  assert.deepEqual(models.available, { image: [], video: [] })
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${SETTINGS_ROUTE}/model-select?t=test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'image', id: defaultSettings.models.image[0].id, revision: 0 }) })).status, 400)
})

test('default private model selections remain visible after the model list reloads', async t => {
  const { writeRegistry } = await import('../src/database/managers/registry.js')
  const { writeSelection } = await import('../src/database/managers/selection.js')
  const root = await mkdtemp(join(tmpdir(), 'default-model-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = { ELYSIUM_SERVERS_FILE: join(root, 'servers.json'), ELYSIUM_CONFIG_FILE: join(root, 'selection.json') }
  await withConfig(config, async () => {
    await writeRegistry({ version: 1, revision: 0, servers: [record('autodl-comfyui')] }, 0)
    await writeSelection({ version: 1, revision: 0, selected: {}, third_party: {} }, 0)
  })
  const handler = createSettingsHandler({ token: 'test', check: async () => ({ ok: true }) })
  const server = createServer((req, res) => withConfig(config, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (action, body) => fetch(`http://127.0.0.1:${server.address().port}${SETTINGS_ROUTE}/${action}?t=test`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  assert.equal((await request('model-select', { kind: 'image', id: 'realvisxl-sdxl', revision: 1 })).status, 200)
  assert.equal((await request('model-select', { kind: 'video', id: 'minimax-h3', revision: 2 })).status, 200)
  const models = await (await request('models')).json()
  assert.deepEqual(models.selected, { image: 'realvisxl-sdxl', video: 'minimax-h3' })
  assert.deepEqual(models.available, { image: ['realvisxl-sdxl'], video: ['minimax-h3'] })
})

test('fixed model catalog probes without connecting and failed selection cannot replace active video or image targets', async t => {
  const { writeRegistry } = await import('../src/database/managers/registry.js')
  const { writeSelection, readSelection } = await import('../src/database/managers/selection.js')
  const { resolveServer } = await import('../src/worker/models/catalog/servers.js')
  const root = await mkdtemp(join(tmpdir(), 'fixed-model-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const upstream = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ system: {}, data: [{ id: 'qwen3.8-27b-elysium' }] })) })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => upstream.close(resolve)))
  const servers = ['a', 'b'].map(id => { const server = record(id); server.services.comfyui.base_url = `http://127.0.0.1:${upstream.address().port}/${id}`; server.services.llm = { transport: 'http', base_url: `http://127.0.0.1:${upstream.address().port}/${id}/v1`, model: 'qwen3.8-27b-elysium' }; return server })
  const config = { ELYSIUM_SERVERS_FILE: join(root, 'servers.json'), ELYSIUM_CONFIG_FILE: join(root, 'config.json'), ELYSIUM_MODELS: { image: [], video: [{ id: 'model-a', label: '视频 A', server_id: 'a' }, { id: 'model-b', label: '视频 B', server_id: 'b' }] } }
  await withConfig(config, async () => {
    await writeRegistry({ version: 1, revision: 0, servers }, 0)
    await writeSelection({ version: 1, revision: 0, selected: { image: 'a', video: 'a' }, third_party: {} }, 0)
  })
  const pinned = withConfig(config, () => resolveServer('video'))
  let failing = true, checks = 0
  const handler = createSettingsHandler({ token: 'test',
    check: async (kind, id) => { checks++; assert.equal(kind, 'video'); assert.equal(id, 'b'); if (failing) throw new Error('private upstream error'); return { ok: true } } })
  const server = createServer((req, res) => withConfig(config, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (action, body) => fetch(`http://127.0.0.1:${server.address().port}${SETTINGS_ROUTE}/${action}?t=test`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  const listed = await (await request('models')).json()
  assert.deepEqual(listed.models.image, [])
  assert.deepEqual(listed.chat_model, { id: 'qwen3.8-27b-elysium', label: 'qwen3.8' })
  assert.equal(listed.selected.video, 'model-a')
  assert.equal((await request('model-status', { kind: 'video', id: 'model-a' })).status, 404)
  assert.equal(checks, 0)
  assert.equal((await request('model-select', { kind: 'image', id: 'unconfigured', revision: 1 })).status, 400)
  assert.equal((await request('tunnel-connect', { id: 'qwen3.8-27b-elysium' })).status, 404)
  assert.equal((await request('model-select', { kind: 'video', id: 'model-b', revision: 1 })).status, 503)
  assert.equal(withConfig(config, () => readSelection().selected.video), 'a')
  failing = false
  assert.equal((await request('model-select', { kind: 'video', id: 'model-b', revision: 1 })).status, 200)
  const selected = withConfig(config, () => readSelection().selected)
  assert.equal(selected.video, 'b'); assert.equal(selected.image, 'a')
  assert.equal(withConfig(config, () => resolveServer('video').server_id), 'b')
  assert.equal(withConfig(config, () => resolveServer().server_id), 'b')
  assert.equal(withConfig(config, () => resolveServer('image').server_id), 'a')
  assert.equal(pinned.server_id, 'a')
  assert.equal((await (await request('model-select', { kind: 'video', id: 'model-b', revision: 2 })).json()).revision, 2)
  assert.equal(withConfig(config, () => readSelection().revision), 2)
  const models = await (await request('models')).json()
  assert.equal(models.selected.video, 'model-b')
  assert.deepEqual(Object.keys(models.models), ['image', 'video'])
})
