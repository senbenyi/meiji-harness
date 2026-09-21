import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultSettings, withConfig } from '../src/config.js'
import { completeStructured } from '../src/worker/models/protocols/openai/completions.js'
import { completeStructured as completeWithConfiguredModel } from '../src/worker/models/index.js'

const settings = { base_url: 'https://llm.test/v1/', model: 'test-model' }
const request = { name: 'test_output', system: '输出 JSON。', user: '生成测试内容。', schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

test('structured completion sends strict schema and parses the model JSON', async () => {
  let call
  const result = await completeStructured(settings, request, { fetcher: async (url, options) => { call = { url, options }; return response({ choices: [{ message: { content: '{"value":"ok"}' } }] }) } })
  assert.deepEqual(result, { value: 'ok' })
  assert.equal(call.url, 'https://llm.test/v1/chat/completions')
  const body = JSON.parse(call.options.body)
  assert.equal(body.model, 'test-model')
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: request.name, strict: true, schema: request.schema } })
})

test('structured completion reports HTTP failure', async () => {
  await assert.rejects(completeStructured(settings, request, { fetcher: async () => response({}, false, 503) }), /HTTP 503/)
})

test('structured completion uses Skill LLM settings with hard limits', async () => {
  let options
  const configured = { ...request, llm: { max_tokens: 50000, timeout_ms: 900000, temperature: 0.8 } }
  await completeStructured(settings, configured, { fetcher: async (_url, value) => { options = value; return response({ choices: [{ message: { content: '{"value":"ok"}' } }] }) } })
  const body = JSON.parse(options.body)
  assert.equal(body.max_tokens, 32768)
  assert.equal(body.temperature, 0.8)
  assert.equal(options.signal.aborted, false)
})

test('structured completion rejects empty model content', async () => {
  await assert.rejects(completeStructured(settings, request, { fetcher: async () => response({ choices: [{ message: { content: '' } }] }) }), /未返回内容/)
})

test('structured completion rejects invalid JSON', async () => {
  await assert.rejects(completeStructured(settings, request, { fetcher: async () => response({ choices: [{ message: { content: 'not-json' } }] }) }), /有效 JSON/)
})

test('configured completion keeps using the chat backend when the registry contains only ComfyUI', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-structured-chat-')), file = join(root, 'settings.json')
  t.after(() => rm(root, { recursive: true, force: true }))
  const value = structuredClone(defaultSettings)
  value.chat.backend.base_url = 'https://chat.test/v1'
  value.connections.servers.push({ id: 'comfy', label: 'ComfyUI', provider: 'autodl', connection_source: 'manual', instance_id: 'gpu', deployment_id: 'one', services: {
    comfyui: { transport: 'http', base_url: 'http://comfy.test', workload: 'minimax-h3' },
  } })
  await writeFile(file, JSON.stringify(value), { mode: 0o600 })
  let url
  const result = await withConfig({ ELYSIUM_SETTINGS_FILE: file }, () => completeWithConfiguredModel(request, { fetcher: async value => {
    url = value
    return response({ choices: [{ message: { content: '{"value":"chat"}' } }] })
  } }))
  assert.deepEqual(result, { value: 'chat' })
  assert.equal(url, 'https://chat.test/v1/chat/completions')
})
