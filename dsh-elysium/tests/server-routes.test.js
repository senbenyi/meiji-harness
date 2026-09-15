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
  assert.equal((await request('register', { revision: 0, server: record('a') })).status, 201)
  assert.equal((await request('register', { revision: 1, server: record('b') })).status, 201)
  assert.equal((await request('register', { revision: 1, server: record('c') })).status, 409)
  const listed = await (await request('list')).json()
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
