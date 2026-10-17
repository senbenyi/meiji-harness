import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { defaults, normalizeModels, modelRoute } from '../models/model-config.js'
import { modelStore } from '../server/data/model-settings.js'
import { migrateSettingsModel } from '../scripts/migrate-settings-model.js'
import { syncChatModel } from '../server/host/harness-chat-model.js'
import { nodeRoutes, composeNodePrompt } from '../server/http/ai-routes.js'
import { sampleInput } from './fixtures/ai.js'
import { createAppRuntime } from '../server/runtime/app-runtime.js'
import { createTaskHttpHandler } from '../server/http/task-routes.js'
import { emptyProject } from '../shared/project_contract.js'

const config = {
  baseUrl: 'https://media.test/v1', apiKey: 'media-secret',
  textBaseUrl: 'http://127.0.0.1:11435/v1',
  text: { model: 'qwen3.5:27b' },
  image: { model: 'gpt-image' }, video: { model: 'elysium-video' },
  output_language: 'zh-CN',
}

test('千问：文本路由和媒体凭据隔离，配置保存不丢失独立地址', async () => {
  const base = await defaults(new URL('./fixtures/absent-local.json', import.meta.url))
  assert.equal(base.text.model, 'qwen3.5:27b')
  assert.equal(base.image.model, 'krea2 turbo V2.5')
  const normalized = normalizeModels(config)
  for (const purpose of ['chat', 'story']) {
    assert.deepEqual(modelRoute(normalized, purpose), { baseUrl: config.textBaseUrl, apiKey: 'ollama', model: 'qwen3.5:27b' })
  }
  assert.deepEqual(modelRoute(normalized, 'image'), { baseUrl: config.textBaseUrl, apiKey: 'ollama', model: 'gpt-image' })
  assert.deepEqual(modelRoute(normalized, 'video'), { baseUrl: config.textBaseUrl, apiKey: 'ollama', model: 'MiniMax-H3' })
  assert.deepEqual(normalized, { ...config, video: { model: 'MiniMax-H3' } })
  assert.throws(() => normalizeModels({ ...config, textBaseUrl: '' }), /网关地址无效/)
  assert.equal(modelRoute({ ...config, apiKey: '' }, 'story').apiKey, 'ollama')
})

test('千问：显式迁移先备份，媒体、额外设置及原备份不变，重复执行不重写', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-qwen-migration-'))
  try {
    const previous = { ...config, text: undefined, textBaseUrl: undefined, chat: { model: 'qwen3.5:27b' }, story: { model: 'qwen3.5:27b' }, concurrency: { text: 4, image: 2, video: 2 } }
    const store = modelStore(home)
    await store.write(previous)
    const before = await readFile(join(home, 'storages/meiji/models.json'), 'utf8')
    const migrated = await migrateSettingsModel(home)
    assert.equal(migrated.changed, true)
    assert.equal(await readFile(migrated.backup, 'utf8'), before)
    const after = await store.read()
    for (const key of ['baseUrl', 'apiKey', 'image', 'concurrency']) assert.deepEqual(after[key], previous[key])
    assert.equal(after.video.model, 'MiniMax-H3')
    assert.equal(after.text.model, 'qwen3.5:27b')
    assert.equal(after.chat, undefined)
    assert.equal(after.story, undefined)
    assert.equal(after.textBaseUrl, config.textBaseUrl)
    assert.equal(after.output_language, 'zh-CN')
    assert.deepEqual(await migrateSettingsModel(home), { changed: false })
    assert.equal(await readFile(migrated.backup, 'utf8'), before)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('迁移把已移除的 elysium 文本与图片选择改为默认可选值，保留连接与额外设置', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-fixed-options-'))
  try {
    const previous = { baseUrl: config.baseUrl, apiKey: config.apiKey, chat: { model: 'elysium-chat' }, story: { model: 'elysium-chat' }, image: { model: 'elysium-image' }, video: { model: 'elysium-video' }, concurrency: { text: 4 } }
    const store = modelStore(home)
    await store.write(previous)
    const migrated = await migrateSettingsModel(home)
    assert.equal(migrated.changed, true)
    const after = await store.read()
    assert.equal(after.text.model, 'qwen3.5:27b')
    assert.equal(after.image.model, 'krea2 turbo V2.5')
    assert.equal(after.video.model, 'MiniMax-H3')
    assert.equal(after.output_language, 'zh-CN')
    for (const key of ['baseUrl', 'apiKey', 'concurrency']) assert.deepEqual(after[key], previous[key])
    assert.equal(after.chat, undefined)
    assert.equal(after.story, undefined)
    await store.write({ ...after, text: { model: 'elysium-chat' } })
    assert.equal((await migrateSettingsModel(home)).changed, true)
    assert.equal((await store.read()).text.model, 'qwen3.5:27b')
    assert.deepEqual(await migrateSettingsModel(home), { changed: false })
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('千问：聊天通过公开服务同步，不依赖媒体密钥，正确声明容量和思考开关', async () => {
  const calls = []
  await syncChatModel({
    credentials: { set: async (...args) => calls.push(['credential', ...args]) },
    settings: { mutate: async (...args) => calls.push(['mutate', ...args]), update: async (...args) => calls.push(['update', ...args]) },
  }, { ...config, apiKey: '' })
  assert.deepEqual(calls[0], ['credential', 'MEIJI_GATEWAY_API_KEY', 'ollama'])
  const provider = calls[1][2][0].value
  assert.equal(provider.baseURL, config.textBaseUrl)
  assert.equal(provider.reasoning, 'off')
  assert.equal(provider.compat.supportsDeveloperRole, false)
  assert.equal(provider.compat.requiresThinkingAsText, false)
  assert.equal(provider.models[0].contextWindow, 262144)
  assert.equal(provider.models[0].maxTokens, undefined)
  assert.deepEqual(provider.models[0].reasoningEfforts, { off: 'none', medium: 'medium' })
  assert.deepEqual(calls[2], ['update', 'agent-default-model', { provider: 'meiji-gateway', model: 'qwen3.5:27b', reasoningEffort: 'off' }])
  assert.ok(!JSON.stringify(calls).includes(config.apiKey))
})

test('千问：所有文本生成/审核/修订保留 system/user 分工，媒体不追加文本约定', async () => {
  let textCount = 0, mediaCount = 0
  for (const [node, route] of Object.entries(nodeRoutes)) for (const [action, contract] of Object.entries(route.actions)) {
    const input = sampleInput(contract.input)
    const prompt = composeNodePrompt(node, action, input, 'qwen3.5:27b')
    assert.equal(prompt.body, node === 'video' ? prompt.user : prompt.messages.map(message => message.content).join("\n\n"))
    assert.ok(!prompt.user.includes('# 输出格式'))
    if (node !== 'video') assert.ok(prompt.user.includes(route.promptModel[action].user.任务.replaceAll('{{输出语言}}', input.language)))
    if (['JSON', '文本'].includes(prompt.output.type)) {
      textCount++
      assert.match(prompt.system, /# 响应约定/)
      assert.match(prompt.system, /只输出符合指定格式的最终结果/)
      assert.ok(!prompt.system.includes('/nothink'))
    } else {
      mediaCount++
      assert.ok(!prompt.body.includes('# 响应约定'))
    }
  }
  assert.equal(textCount, 29)
  assert.equal(mediaCount, 6)
})

test('千问：真实 runtime 经独立文本 HTTP 完成生成、审核及修订；设置 API 保留媒体密钥', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-qwen-runtime-'))
  const requests = []
  let runtime, api, reviews = 0
  const modelServer = createServer(async (req, res) => {
    let data = ''
    for await (const chunk of req) data += chunk
    const body = JSON.parse(data)
    requests.push({ url: req.url, authorization: req.headers.authorization, body })
    const review = body.messages[1].content.includes('审核当前目标')
    const content = review ? JSON.stringify({ 是否通过: ++reviews > 1, 原因: reviews === 1 ? '摘要需要保留结局' : '' }) : '小林找回丢失的钥匙。'
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content, reasoning: '不进入下一轮提示' } }] }))
  })
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve))
  try {
    const local = { ...config, textBaseUrl: `http://127.0.0.1:${modelServer.address().port}/v1` }
    await modelStore(home).write(local)
    runtime = await createAppRuntime({ home })
    api = createServer(createTaskHttpHandler(runtime, { authorize: () => null }))
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${api.address().port}/api/meiji/models`
    const get = await (await fetch(url)).json()
    assert.deepEqual(get.settings, { output_language: 'zh-CN', text: config.text, image: config.image, video: { model: 'MiniMax-H3' } })
    assert.ok(!JSON.stringify(get).includes(config.apiKey))
    const saved = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meiji-Request': '1' }, body: JSON.stringify({ settings: get.settings }) })
    assert.equal(saved.status, 200)
    assert.deepEqual(await runtime.models.read(), { ...local, video: { model: 'MiniMax-H3' } })
    const p = emptyProject({ name: '连接测试', creation_mode: '剧本' })
    p.script.body = '小林丢了钥匙，回到公园长椅旁，找回了钥匙。'
    const model = await runtime.repository.create(p)
    const submitted = await runtime.tasks.command({ type: 'submit', project_id: p.id, request_id: 'qwen', business_type: 'project-summary', target_id: p.id, action: 'generate' })
    await runtime.tasks.idle(p.id)
    const task = model.readAll().tasks.find(t => t.id === submitted.task_id)
    assert.equal(task.task_status, 'completed', task.end_reason)
    assert.equal(requests.length, 4)
    for (const request of requests) {
      assert.equal(request.url, '/v1/chat/completions')
      assert.equal(request.authorization, 'Bearer ollama')
      assert.equal(request.body.model, 'qwen3.5:27b')
      for (const key of ['reasoning_effort', 'temperature', 'top_p', 'presence_penalty']) assert.equal(request.body[key], undefined)
      assert.equal(request.body.max_tokens, undefined)
      assert.ok(!JSON.stringify(request).includes('不进入下一轮提示'))
    }
    assert.match(requests[2].body.messages.at(-1).content, /摘要需要保留结局/)
  } finally {
    await runtime?.dispose()
    for (const server of [api, modelServer].filter(Boolean)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await rm(home, { recursive: true, force: true })
  }
})
