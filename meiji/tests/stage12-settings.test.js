import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { SettingsModel } from '../shared/models/settings_model.js'
import { modelStore } from '../server/data/model-settings.js'
import { modelRoute } from '../models/model-config.js'
import { createAppRuntime } from '../server/runtime/app-runtime.js'
import { createTaskHttpHandler } from '../server/http/task-routes.js'
import { syncChatModel } from '../server/host/harness-chat-model.js'
import { emptyProject } from '../shared/project_contract.js'

const selection = { text: { model: 'qwen3.5:27b' }, image: { model: 'elysium-image' }, video: { model: 'elysium-video' } }
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/v1`)))

test('设置 Model 拒绝未知选项、图片冒用文本，聊天和制作同源', () => {
  assert.throws(() => new SettingsModel({ ...selection, text: { model: 'unknown' } }), /请选择有效模型/)
  assert.throws(() => new SettingsModel({ ...selection, image: selection.text }), /请选择有效模型/)
  const config = { ...selection, baseUrl: 'https://gateway.test/v1', textBaseUrl: 'http://localhost:11435/v1', apiKey: 'private' }
  assert.deepEqual(modelRoute(config, 'chat'), modelRoute(config, 'story'))
  assert.equal(modelRoute(config, 'image').model, 'elysium-image')
  assert.equal(modelRoute(config, 'video').model, 'elysium-video')
  assert.equal(modelRoute(config, 'image').apiKey, 'private')
})

test('设置 API 切换后下一次制作使用对应 HTTP、凭据与参数，重建 runtime 恢复选项', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-settings-'))
  const requests = []
  const server = kind => createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push({ kind, path: req.url, authorization: req.headers.authorization, body })
    const content = body.messages[1].content.includes('审核当前目标') ? JSON.stringify({ 是否通过: true, 原因: '' }) : '阿明找回了失落的钥匙。'
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))
  })
  const remote = server('gateway'), local = server('qwen')
  let runtime, api
  try {
    const config = { ...selection, baseUrl: await listen(remote), textBaseUrl: await listen(local), apiKey: 'gateway-secret', concurrency: { text: 4 } }
    await modelStore(home).write(config)
    runtime = await createAppRuntime({ home })
    const synced = []
    runtime.syncModels = value => syncChatModel({ credentials: { set: async (_, key) => synced.push(key) }, settings: { mutate: async (_, ops) => synced.push(ops[0].value), update: async () => {} } }, value)
    api = createServer(createTaskHttpHandler(runtime))
    const url = (await listen(api)).replace('/v1', '/api/meiji/models')
    const save = settings => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meiji-Request': '1' }, body: JSON.stringify({ settings }) })
    const publicConfig = await (await fetch(url)).json()
    assert.deepEqual(publicConfig.settings, selection)
    for (const [modelName, kind, key] of [['elysium-chat', 'gateway', 'gateway-secret'], ['qwen3.5:27b', 'qwen', 'ollama']]) {
      const before = requests.length
      const response = await save({ ...selection, text: { model: modelName }, apiKey: 'must-not-overwrite', baseUrl: 'http://must-not-use.test' })
      assert.equal(response.status, 200)
      assert.equal(synced.at(-2), key)
      assert.equal(synced.at(-1).models[0].contextWindow, kind === 'qwen' ? 32768 : 65536)
      const p = emptyProject({ name: 'HTTP验证', creation_mode: '剧本' }); p.script.body = '阿明丢失钥匙，寻找后找回。'
      const project = await runtime.repository.create(p)
      const submitted = await runtime.tasks.command({ type: 'submit', project_id: p.id, request_id: modelName, business_type: 'project-summary', target_id: p.id, action: 'generate' })
      await runtime.tasks.idle(p.id)
      const task = project.read().tasks.find(t => t.id === submitted.task_id)
      assert.equal(task.task_status, 'completed', task.end_reason)
      assert.equal(requests.length - before, 2)
      for (const req of requests.slice(before)) {
        assert.equal(req.kind, kind); assert.equal(req.path, '/v1/chat/completions')
        assert.equal(req.authorization, `Bearer ${key}`); assert.equal(req.body.model, modelName)
        assert.equal(req.body.reasoning_effort, undefined) // Qwen 默认参数由 llm-server 补齐
      }
    }
    const persisted = await runtime.models.read()
    assert.deepEqual(persisted.concurrency, { text: 4 })
    assert.equal(persisted.apiKey, 'gateway-secret')
    assert.equal((await save({ ...selection, text: { model: 'bad' } })).status, 400)
    runtime.syncModels = async () => { throw Error('聊天同步失败') }
    assert.equal((await save({ ...selection, text: { model: 'elysium-chat' } })).status, 422)
    assert.deepEqual(await runtime.models.read(), persisted)
    await runtime.dispose(); runtime = await createAppRuntime({ home })
    assert.deepEqual(await runtime.models.read(), persisted)
  } finally {
    await runtime?.dispose()
    for (const s of [api, remote, local].filter(Boolean)) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)) }
    await rm(home, { recursive: true, force: true })
  }
})
