// 职责：验证平台契约发现和 Runpod 服务全流程组合，不访问真实实例。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { loadProvider, listProviders, validateProvider } from '../../../runtime/loader.js'
import { validateBackend } from '../../../runtime/index.js'

test('Runpod exposes the complete contract; missing or incomplete adapters never fall back', async () => {
  const provider = await loadProvider('runpod')
  assert.equal(provider.id, 'runpod')
  for (const method of ['validate', 'connect', 'check', 'createClient', 'buildGraph', 'llmSettings', 'workflowSource', 'manage']) assert.equal(typeof provider[method], 'function')
  const rows = await listProviders()
  assert.equal(rows.find(item => item.id === 'runpod').available, true)
  assert.equal(rows.find(item => item.id === 'autodl').available, false)
  await assert.rejects(loadProvider('autodl'), { code: 'PROVIDER_UNAVAILABLE' })
  await assert.rejects(loadProvider('../runpod'), { code: 'PROVIDER_UNAVAILABLE' })
  assert.throws(() => validateProvider({ ...provider, connect: undefined }, 'runpod'), /契约/)
  await assert.rejects(validateBackend({ provider: 'runpod', provider_api_version: 99, service: 'comfyui' }), { code: 'PROVIDER_VERSION_MISMATCH' })
  const backend = { provider: 'runpod', instance_id: 'a', deployment_id: 'one', service: 'comfyui', base_url: 'http://fixture.test', connection: { transport: 'http', workload: 'minimax-h3' } }
  await validateBackend(backend)
  const client = provider.createClient(backend)
  for (const method of ['submit', 'wait', 'request', 'viewUrl']) assert.equal(typeof client[method], 'function')
  const graph = await provider.buildGraph(backend, { profile: 'preview', mode: 't2va', prompt: 'A scene' }, 'test')
  assert.ok(graph.graph[graph.outputNode])
  assert.equal(provider.workflowSource(backend), backend.base_url)
})

test('Runpod lifecycle checks, starts, reuses, restarts and stops only its own simulated process', async t => {
  const root = await mkdtemp(join(tmpdir(), 'runpod-service-')); t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'ComfyUI')); await writeFile(join(root, 'comfyui_args.txt'), '--lowvram\n# comment\n')
  let running = false, starts = 0, killed = [], foreign = false, wrongPort = false
  const command = `${root}/ComfyUI/.venv-cu130/bin/python main.py --port 8188`
  const system = {
    fetch: async url => { assert.equal(url, 'http://127.0.0.1:8188/system_stats'); return { ok: true } },
    spawn: (path, args) => { assert.equal(path, `${root}/ComfyUI/.venv-cu130/bin/python`); assert.ok(args.includes('--lowvram')); starts++; running = true; const child = new EventEmitter(); child.pid = 1234; child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child },
    spawnSync: () => ({ status: running ? 0 : 1, stdout: foreign ? 'unrelated process' : wrongPort ? command + '0' : command }),
    kill: (pid, signal) => { assert.equal(signal, 'SIGTERM'); killed.push(pid); running = false }, pause: async () => {},
  }
  const provider = await loadProvider('runpod'), options = { root, system }
  assert.equal((await provider.manage('check', options)).status, 'ready')
  assert.equal((await provider.manage('start', options)).status, 'started')
  assert.equal((await provider.manage('start', options)).status, 'running'); assert.equal(starts, 1)
  foreign = true
  await assert.rejects(provider.manage('stop', options), /身份不匹配/); assert.equal(killed.length, 0)
  foreign = false; wrongPort = true
  await assert.rejects(provider.manage('stop', options), /身份不匹配/); assert.equal(killed.length, 0)
  wrongPort = false
  assert.equal((await provider.manage('restart', options)).status, 'started'); assert.equal(starts, 2)
  assert.equal((await provider.manage('stop', options)).status, 'stopped')
  assert.deepEqual(killed, [1234, 1234])
  await assert.rejects(provider.manage('destroy', options), /仅支持/)
})
