// 职责：验证 AutoDL 双服务器契约可发现且不依赖其他 provider。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadProvider, listProviders } from '../src/servers/runtime/loader.js'
import { validateBackend } from '../src/servers/runtime/index.js'
import { ComfyClient } from '../src/comfyui/client.js'

test('AutoDL exposes independent ComfyUI and Qwen contracts', async () => {
  const provider = await loadProvider('autodl')
  assert.equal(provider.id, 'autodl')
  assert.deepEqual(Object.keys(provider.services).sort(), ['comfyui', 'llm'])
  for (const method of ['validate', 'connect', 'check', 'createClient', 'buildGraph', 'llmSettings', 'workflowSource', 'manage']) assert.equal(typeof provider[method], 'function')
  assert.equal((await listProviders()).find(item => item.id === 'autodl').available, true)
  const comfyui = { provider: 'autodl', instance_id: 'image-video', deployment_id: 'one', service: 'comfyui', base_url: 'http://fixture.test', connection: { transport: 'http', workload: 'minimax-h3' } }
  const llm = { provider: 'autodl', instance_id: 'qwen', deployment_id: 'one', service: 'llm', base_url: 'http://fixture.test/v1', connection: { transport: 'http', model: 'qwen3.8-27b-elysium' } }
  await validateBackend(comfyui)
  await validateBackend(llm)
  assert.equal(provider.llmSettings(llm).model, 'qwen3.8-27b-elysium')
  const source = await readFile(new URL('../src/servers/providers/autodl/index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /providers\/runpod|\.\.\/runpod|from ['"].*runpod/)
})

test('AutoDL rejects mismatched workloads and cross-service declarations', async () => {
  const base = { provider: 'autodl', instance_id: 'a', deployment_id: 'one', service: 'comfyui', base_url: 'http://fixture.test' }
  await assert.rejects(validateBackend({ ...base, connection: { transport: 'http', workload: 'other' } }), /ComfyUI/)
  await assert.rejects(validateBackend({ ...base, service: 'llm', connection: { transport: 'http', model: 'other' } }), /LLM/)
})

test('AutoDL readiness checks the requested image or video workflow', async t => {
  const provider = await loadProvider('autodl'), graphs = []
  const backend = { provider: 'autodl', instance_id: 'image-video', deployment_id: 'one', service: 'comfyui', base_url: 'http://fixture.test', connection: { transport: 'http', workload: 'minimax-h3' } }
  t.mock.method(ComfyClient.prototype, 'request', async path => { assert.equal(path, 'system_stats'); return {} })
  t.mock.method(ComfyClient.prototype, 'validate', async graph => { graphs.push(graph) })
  await provider.check(backend, { kind: 'image' })
  await provider.check(backend, { kind: 'video' })
  assert.ok(Object.values(graphs[0]).some(node => Object.values(node.inputs).includes('RealVisXL_V5.0_fp16.safetensors')))
  assert.ok(Object.values(graphs[1]).some(node => node.class_type === 'MiniMaxH3Director'))
})
