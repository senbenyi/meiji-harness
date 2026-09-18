// 职责：验证检查失败与选择配置并发修改不会误切换新任务目标。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { writeRegistry } from '../src/database/managers/registry.js'
import { readSelection, writeSelection } from '../src/database/managers/selection.js'
import { checkServer, switchServer } from '../src/models/managers/runtime/check.js'
import { ComfyClient } from '../src/models/protocols/comfyui/client.js'

const fixture = () => ({ version: 1, revision: 0, servers: ['a', 'b'].map(id => ({ id, label: id, provider: 'manual', connection_source: 'manual', instance_id: id, deployment_id: 'one', services: { comfyui: { transport: 'http', base_url: `http://${id}.test`, workload: 'minimax-h3' } } })) })

test('failed checks and stale selection revisions preserve the default; successful check never submits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'switch-')); t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_SERVERS_FILE: join(root, 'servers.json'), ELYSIUM_CONFIG_FILE: join(root, 'config.json') }, async () => {
    await writeRegistry(fixture(), 0)
    await writeSelection({ version: 1, revision: 0, selected: { video: 'a' }, third_party: {} }, 0)
    await assert.rejects(switchServer('video', 'b', 1, async () => { throw new Error('missing models') }), /missing/)
    assert.equal(readSelection().selected.video, 'a')
    await assert.rejects(switchServer('video', 'b', 1, async () => {
      await writeSelection({ ...readSelection(), selected: { video: 'a' } }, 1)
      return { ok: true }
    }), /版本冲突/)
    assert.equal(readSelection().selected.video, 'a')
    const graphs = []
    t.mock.method(ComfyClient.prototype, 'request', async path => { assert.equal(path, 'system_stats'); return {} })
    t.mock.method(ComfyClient.prototype, 'validate', async function (graph) { assert.equal(this.url.hostname, 'b.test'); graphs.push(graph) })
    t.mock.method(ComfyClient.prototype, 'submit', () => assert.fail('checks must not submit'))
    const result = await switchServer('video', 'b', 2)
    assert.equal(result.effect, 'new_jobs'); assert.equal(readSelection().selected.video, 'b'); assert.equal(graphs.length, 7)
    await assert.rejects(checkServer('magic', 'b'), /未知/)
  })
})

test('Harness text model selection is outside Elysium', async () => {
  await assert.rejects(switchServer('llm', 'text', 0), /只管理图片和视频/)
})

test('readiness cannot claim missing model lists are verified', async () => {
  const client = new ComfyClient('http://fixture.test')
  client.request = async () => ({ UNETLoader: { input: { required: { unet_name: [[]] } }, output: ['MODEL'] } })
  const graph = { one: { class_type: 'UNETLoader', inputs: { unet_name: 'model.safetensors' } } }
  await assert.rejects(client.validate(graph, { verifyModels: true }), /模型列表不可核验/)
})
