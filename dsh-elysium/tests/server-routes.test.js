// 职责：验证服务器端点认证、脱敏、版本冲突、失败回执和停用边界。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createServerHandler, SERVER_ROUTE } from '../src/http/server-routes.js'
const record = id => ({ id, label: id, provider: 'runpod', connection_source: 'manual', instance_id: id, deployment_id: 'one', services: { comfyui: { transport: 'http', base_url: `http://${id}.test`, workload: 'minimax-h3' } } })
test('all endpoints authenticate before IO; registration stays manual and switching is checked', async t => {
  const root = await mkdtemp(join(tmpdir(), 'server-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let fail = false, calls = 0
  const handler = createServerHandler({ token: 'test', check: async () => { calls++; if (fail) throw new Error('PRIVATE_API_KEY=secret'); return { ok: true } } })
  const server = createServer((req, res) => withConfig({ ELYSIUM_SERVERS_FILE: join(root, 'servers.json') }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (action, body, token = 'test') => fetch(`http://127.0.0.1:${server.address().port}${SERVER_ROUTE}/${action}?t=${token}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  for (const action of ['list', 'register', 'check', 'switch', 'set-enabled']) assert.equal((await request(action, action === 'list' ? null : {}, 'bad')).status, 401)
  assert.equal(calls, 0)
  assert.equal((await request('register', { revision: 0, server: { ...record('unavailable'), provider: 'autodl' } })).status, 409)
  assert.equal((await request('register', { revision: 0, server: record('a') })).status, 201)
  assert.equal((await request('register', { revision: 1, server: record('b') })).status, 201)
  assert.equal((await request('register', { revision: 1, server: record('c') })).status, 409)
  const listed = await (await request('list')).json()
  assert.equal(listed.providers.find(provider => provider.id === 'runpod').available, true)
  assert.equal(listed.providers.find(provider => provider.id === 'autodl').available, false)
  assert.deepEqual(listed.active, {}); assert.equal(listed.servers.length, 2)
  assert.doesNotMatch(JSON.stringify(listed), /base_url|instance_id|ssh_identity|api_key/)
  assert.equal((await request('switch', { id: 'a', service: 'comfyui', revision: 2 })).status, 200)
  fail = true
  const failed = await request('switch', { id: 'b', service: 'comfyui', revision: 3 })
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /PRIVATE|secret/)
  assert.equal((await (await request('list')).json()).active.comfyui, 'a')
  assert.equal((await request('set-enabled', { id: 'a', enabled: false, revision: 3 })).status, 400)
  assert.equal((await request('set-enabled', { id: 'b', enabled: false, revision: 3 })).status, 200)
  assert.equal((await request('check', { id: 'b', service: 'comfyui' })).status, 400)
  assert.equal((await request('delete', { id: 'a', revision: 4 })).status, 404)
})

test('fixed model catalog probes without connecting and failed selection cannot replace active video or image targets', async t => {
  const { writeRegistry, readRegistry } = await import('../src/servers/registry/store.js')
  const { resolveServer } = await import('../src/servers/registry/resolve.js')
  const root = await mkdtemp(join(tmpdir(), 'fixed-model-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const upstream = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ system: {}, data: [{ id: 'qwen3.8-27b-elysium' }] })) })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => upstream.close(resolve)))
  const servers = ['a', 'b'].map(id => { const server = record(id); server.services.comfyui.base_url = `http://127.0.0.1:${upstream.address().port}/${id}`; server.services.llm = { transport: 'http', base_url: `http://127.0.0.1:${upstream.address().port}/${id}/v1`, model: 'qwen3.8-27b-elysium' }; return server })
  const config = { ELYSIUM_SERVERS_FILE: join(root, 'servers.json'), ELYSIUM_MODELS: { llm: [], analysis: [{ id: 'qwen-a', label: 'Qwen A', server_id: 'a' }, { id: 'qwen-b', label: 'Qwen B', server_id: 'b' }], image: [], video: [{ id: 'model-a', label: '视频 A', server_id: 'a' }, { id: 'model-b', label: '视频 B', server_id: 'b' }] } }
  await withConfig(config, () => writeRegistry({ version: 1, revision: 0, active: { comfyui: 'a', llm: 'a', image: 'a', video: 'a' }, servers }, 0))
  const pinned = withConfig(config, () => resolveServer('video'))
  let failing = true, checks = 0
  const handler = createServerHandler({ token: 'test', check: async (kind, id) => { checks++; assert.ok(['video', 'analysis'].includes(kind)); assert.equal(id, 'b'); if (failing) throw new Error('private upstream error'); return { ok: true } } })
  const server = createServer((req, res) => withConfig(config, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (action, body) => fetch(`http://127.0.0.1:${server.address().port}${SERVER_ROUTE}/${action}?t=test`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  const listed = await (await request('models')).json()
  assert.deepEqual(listed.models.image, [])
  assert.equal(listed.selected.video, 'model-a')
  assert.equal((await (await request('model-status', { kind: 'video', id: 'model-a' })).json()).connected, true)
  assert.equal(checks, 0)
  assert.equal((await request('model-connect', { kind: 'image', id: 'unconfigured', revision: 1 })).status, 400)
  assert.equal((await request('model-connect', { kind: 'video', id: 'model-b', revision: 1 })).status, 503)
  assert.equal(withConfig(config, () => readRegistry().active.video), 'a')
  failing = false
  assert.equal((await request('model-connect', { kind: 'video', id: 'model-b', revision: 1 })).status, 200)
  const active = withConfig(config, () => readRegistry().active)
  assert.equal(active.video, 'b'); assert.equal(active.image, 'a'); assert.equal(active.comfyui, 'a')
  assert.equal(withConfig(config, () => resolveServer('video').server_id), 'b')
  assert.equal(withConfig(config, () => resolveServer().server_id), 'b')
  assert.equal(withConfig(config, () => resolveServer('image').server_id), 'a')
  assert.equal(pinned.server_id, 'a')
  assert.equal((await (await request('models')).json()).selected.video, 'model-b')
  assert.equal(withConfig(config, () => resolveServer('analysis').server_id), 'a')
  assert.equal((await (await request('model-status', { kind: 'analysis', id: 'qwen-a' })).json()).connected, true)
  const connected = await (await request('model-connect', { kind: 'analysis', id: 'qwen-b', revision: 2 })).json()
  assert.equal(connected.connected, true); assert.equal(connected.revision, 3); assert.equal(connected.pending, false)
  assert.equal(withConfig(config, () => resolveServer('analysis').server_id), 'b')
  assert.equal(withConfig(config, () => resolveServer('llm').server_id), 'a')
  assert.equal((await (await request('models')).json()).selected.analysis, 'qwen-b')
})
