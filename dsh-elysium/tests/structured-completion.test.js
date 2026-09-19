import assert from 'node:assert/strict'
import test from 'node:test'
import { completeStructured } from '../src/worker/models/protocols/openai/completions.js'

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

test('structured completion rejects empty model content', async () => {
  await assert.rejects(completeStructured(settings, request, { fetcher: async () => response({ choices: [{ message: { content: '' } }] }) }), /未返回内容/)
})

test('structured completion rejects invalid JSON', async () => {
  await assert.rejects(completeStructured(settings, request, { fetcher: async () => response({ choices: [{ message: { content: 'not-json' } }] }) }), /有效 JSON/)
})
