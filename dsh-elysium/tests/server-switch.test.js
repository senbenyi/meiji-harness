// 职责：验证显式检查失败与并发修改不会误切换默认目标。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { writeRegistry, readRegistry } from '../src/servers/registry/store.js'
import { checkServer, switchServer } from '../src/servers/runtime/check.js'
import { ComfyClient } from '../src/comfyui/client.js'
const fixture = () => ({ version: 1, revision: 0, active: { comfyui: 'a' }, servers: ['a', 'b'].map(id => ({ id, label: id, provider: 'manual', connection_source: 'manual', instance_id: id, deployment_id: 'one', services: { comfyui: { transport: 'http', base_url: `http://${id}.test`, workload: 'minimax-h3' } } })) })
test('failed checks and stale revisions preserve the default; successful check covers every graph without submission', async t => {
  const root = await mkdtemp(join(tmpdir(), 'switch-')); t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_SERVERS_FILE: join(root, 'servers.json') }, async () => {
    await writeRegistry(fixture(), 0)
    await assert.rejects(switchServer('comfyui', 'b', 1, async () => { throw new Error('missing models') }), /missing/)
    assert.equal(readRegistry().active.comfyui, 'a')
    await assert.rejects(switchServer('comfyui', 'b', 1, async () => {
      await writeRegistry({ ...readRegistry(), active: { comfyui: 'a' } }, 1)
      return { ok: true }
    }), /版本冲突/)
    assert.equal(readRegistry().active.comfyui, 'a')
    const graphs = []
    t.mock.method(ComfyClient.prototype, 'request', async path => { assert.equal(path, 'system_stats'); return {} })
    t.mock.method(ComfyClient.prototype, 'validate', async function (graph) { assert.equal(this.url.hostname, 'b.test'); graphs.push(graph) })
    t.mock.method(ComfyClient.prototype, 'submit', () => assert.fail('checks must not submit'))
    const result = await switchServer('comfyui', 'b', 2)
    assert.equal(result.effect, 'new_jobs'); assert.equal(readRegistry().active.comfyui, 'b'); assert.equal(graphs.length, 7)
    await assert.rejects(checkServer('magic', 'b'), /未知/)
  })
})

test('readiness cannot claim missing model lists are verified', async () => {
  const client = new ComfyClient('http://fixture.test')
  client.request = async () => ({ UNETLoader: { input: { required: { unet_name: [[]] } }, output: ['MODEL'] } })
  const graph = { one: { class_type: 'UNETLoader', inputs: { unet_name: 'model.safetensors' } } }
  await assert.rejects(client.validate(graph, { verifyModels: true }), /模型列表不可核验/)
})

test('LLM model checks preserve the old selection on failure and return next-start receipt on success', async t => {
  const root = await mkdtemp(join(tmpdir(), 'llm-switch-')); t.after(() => rm(root, { recursive: true, force: true }))
  let available = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://b.test/v1/models')
    assert.equal(options.headers.Authorization, 'Bearer test-only-key')
    return new Response(JSON.stringify({ data: available ? [{ id: 'qwen3.8-27b-elysium' }] : [] }), { headers: { 'Content-Type': 'application/json' } })
  })
  await withConfig({ ELYSIUM_SERVERS_FILE: join(root, 'servers.json'), TEST_LLM_KEY: 'test-only-key' }, async () => {
    const registry = fixture()
    registry.active = { llm: 'a' }
    for (const server of registry.servers) server.services = { llm: { transport: 'http', base_url: `http://${server.id}.test/v1`, model: 'qwen3.8-27b-elysium', api_key_env: 'TEST_LLM_KEY' } }
    await writeRegistry(registry, 0)
    await assert.rejects(switchServer('llm', 'b', 1), /缺少配置的文本模型/)
    assert.equal(readRegistry().active.llm, 'a'); assert.equal(readRegistry().revision, 1)
    available = true
    const result = await switchServer('llm', 'b', 1)
    assert.equal(result.effect, 'next_start'); assert.equal(readRegistry().active.llm, 'b')
  })
})
