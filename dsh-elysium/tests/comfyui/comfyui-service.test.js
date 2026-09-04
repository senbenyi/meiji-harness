import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import * as path from 'node:path'
import test from 'node:test'
import { createComfyUiService, resolveComfyUiConfig } from '../../src/infrastructure/comfyui/service.js'
import { testTemplateReadiness } from '../../src/infrastructure/comfyui/engine.js'

test('internal ComfyUI runtime seeds bundled workflows into the Elysium workspace', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))

  const runtime = resolveComfyUiConfig({ workspace, comfyui: { baseUrl: 'http://127.0.0.1:8189/' } })

  assert.equal(runtime.baseUrl, 'http://127.0.0.1:8189')
  assert.match(runtime.templatesDir, /elysium-comfyui-/)
  const contract = JSON.parse(await readFile(path.join(runtime.templatesDir, 'qwen-image-t2i.contract.json'), 'utf8'))
  assert.equal(contract.id, 'qwen-image-t2i')
})

test('internal ComfyUI settings persist without a second plugin', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-settings-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const service = createComfyUiService({ workspace, comfyui: { baseUrl: 'http://127.0.0.1:9' } })

  await service.saveSettings({ baseUrl: 'http://127.0.0.1:18189' })
  assert.equal(service.runtime().baseUrl, 'http://127.0.0.1:18189')
})

test('model routing lists registered text models and updates the live config', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-model-routing-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const config = { workspace, comfyui: { baseUrl: 'http://127.0.0.1:9' }, planner: {}, models: {} }
  const llm = {
    listProviders: () => [{ id: 'openai', name: 'OpenAI' }, { id: 'offline', name: 'Offline' }],
    listModels: async provider => {
      if (provider === 'offline') throw new Error('not configured')
      return [{ provider, id: 'gpt-5.5', name: 'GPT-5.5' }]
    },
  }
  const service = createComfyUiService(config, llm)

  const initial = await service.state()
  assert.equal(initial.textProviders[0].models[0].id, 'gpt-5.5')
  assert.equal(initial.textProviders[1].error, 'not configured')
  await service.saveSettings({ modelRouting: {
    planner: { provider: 'openai', model: 'gpt-5.5', maxTokens: 8192 },
    stages: { characterImage: 'anima-txt2img', chapterVideo: 'wan22-remix-long' },
  } })
  assert.deepEqual(config.planner, { provider: 'openai', model: 'gpt-5.5', maxTokens: 8192 })
  assert.equal(config.models.characterImage.template, 'anima-txt2img')

  const restartedConfig = { workspace, comfyui: { baseUrl: 'http://127.0.0.1:9' }, planner: {}, models: {} }
  createComfyUiService(restartedConfig, llm)
  assert.deepEqual(restartedConfig.planner, { provider: 'openai', model: 'gpt-5.5', maxTokens: 8192 })
  assert.equal(restartedConfig.models.characterImage.template, 'anima-txt2img')
})

test('connection test validates a draft URL without saving it', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-test-'))
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ system: { comfyui_version: 'test' }, devices: [{ name: 'Test GPU' }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.close()
    return rm(workspace, { recursive: true, force: true })
  })
  const service = createComfyUiService({ workspace, comfyui: { baseUrl: 'http://127.0.0.1:9' } })
  const draftUrl = `http://127.0.0.1:${server.address().port}`

  const tested = await service.testConnection({ baseUrl: draftUrl })

  assert.equal(tested.ping.ok, true)
  assert.equal(tested.ping.device, 'Test GPU')
  assert.equal(service.runtime().baseUrl, 'http://127.0.0.1:9')
  await assert.rejects(service.saveSettings({ baseUrl: 'not-a-url' }), error => error.code === 'BAD_BASE_URL')
})

test('workflow test checks live nodes without submitting a generation', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-workflow-test-'))
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/system_stats') return res.end(JSON.stringify({ system: {}, devices: [] }))
    if (req.url === '/object_info/TestNode') return res.end(JSON.stringify({ TestNode: { python_module: 'nodes', input: { required: {} } } }))
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.close()
    return rm(workspace, { recursive: true, force: true })
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const service = createComfyUiService({ workspace, comfyui: { baseUrl } })
  const { templatesDir } = service.runtime()
  await writeFile(path.join(templatesDir, 'test-ready.json'), JSON.stringify({ 1: { class_type: 'TestNode', inputs: {} } }))
  await writeFile(path.join(templatesDir, 'test-ready.contract.json'), JSON.stringify({ id: 'test-ready', title: 'Test Ready', workflow: 'test-ready.json', slots: {} }))

  const result = await service.testTemplate('test-ready')

  assert.equal(result.ready, true)
  assert.equal(result.checked_nodes, 1)
  assert.ok(requests.includes('/object_info/TestNode'))
  assert.ok(!requests.includes('/prompt'))
})

test('workflow test retries one transient ComfyUI status timeout', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-workflow-retry-'))
  let statusRequests = 0
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/system_stats') {
      statusRequests += 1
      if (statusRequests === 1) return
      return res.end(JSON.stringify({ system: {}, devices: [] }))
    }
    if (req.url === '/object_info/TestNode') return res.end(JSON.stringify({ TestNode: { python_module: 'nodes', input: { required: {} } } }))
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections?.()
    server.close()
    return rm(workspace, { recursive: true, force: true })
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const service = createComfyUiService({ workspace, comfyui: { baseUrl } })
  const { templatesDir } = service.runtime()
  await writeFile(path.join(templatesDir, 'retry-ready.json'), JSON.stringify({ 1: { class_type: 'TestNode', inputs: {} } }))
  await writeFile(path.join(templatesDir, 'retry-ready.contract.json'), JSON.stringify({ id: 'retry-ready', workflow: 'retry-ready.json', slots: {} }))

  const result = await testTemplateReadiness({ baseUrl, templatesDir, template: 'retry-ready', pingTimeout: 500 })

  assert.equal(statusRequests, 2)
  assert.equal(result.ready, true)
})

test('bundled workflows are protected and offline LoRA availability stays unknown', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-protected-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const service = createComfyUiService({ workspace, comfyui: { baseUrl: 'http://127.0.0.1:9' } })

  const state = await service.state()

  assert.ok(state.templates.some(item => item.id === 'qwen-image-t2i' && item.removable === false))
  assert.ok(state.loras.every(item => item.on_server === null))
  await assert.rejects(service.removeTemplate('qwen-image-t2i'), error => error.code === 'BUNDLED_TEMPLATE')
})

test('newer bundled contracts upgrade stale runtime templates together with their workflow', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-comfyui-upgrade-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const config = { workspace, comfyui: { baseUrl: 'http://127.0.0.1:8189' } }
  const runtime = resolveComfyUiConfig(config)
  const contractPath = path.join(runtime.templatesDir, 'qwen-image-edit.contract.json')
  const workflowPath = path.join(runtime.templatesDir, 'qwen-image-edit.json')

  await writeFile(contractPath, JSON.stringify({ id: 'qwen-image-edit', _bundleVersion: 1, workflow: 'qwen-image-edit.json', slots: {} }))
  await writeFile(workflowPath, JSON.stringify({ stale: true }))
  resolveComfyUiConfig(config)

  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  const workflow = JSON.parse(await readFile(workflowPath, 'utf8'))
  assert.equal(contract._bundleVersion, 2)
  assert.equal(contract.slots.character_image.node, '14')
  assert.equal(workflow['14'].class_type, 'LoadImage')
  assert.equal(workflow.stale, undefined)
})
