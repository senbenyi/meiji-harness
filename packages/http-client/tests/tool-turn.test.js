import test from 'node:test'
import assert from 'node:assert/strict'
import { modelClient } from '../src/index.js'

const json = value => new Response(JSON.stringify(value), { status: 200 })
const baseUrl = 'http://models.example/v1'
test('turn透传工具、tool_choice及完整消息，保留空正文的工具响应', async () => {
  const tools = [{ type: 'function', function: { name: 'read_material', parameters: { type: 'object' } } }]
  const toolCall = { id: 'read-1', type: 'function', function: { name: 'read_material', arguments: '{"name":"script"}' } }
  const messages = [{ role: 'user', content: '目标和索引' }]
  const first = await modelClient.turn({ baseUrl, model: 'writer', messages, tools, toolChoice: 'auto', fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body)
    assert.deepEqual(body.tools, tools); assert.equal(body.tool_choice, 'auto'); assert.equal(body.stream, false)
    return json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [toolCall] } }] })
  } })
  assert.deepEqual(first, { role: 'assistant', content: null, tool_calls: [toolCall] })
  const next = [...messages, first, { role: 'tool', tool_call_id: 'read-1', content: '原稿' }]
  const second = await modelClient.turn({ baseUrl, model: 'writer', messages: next, tools, fetchImpl: async (_, request) => {
    assert.deepEqual(JSON.parse(request.body).messages, next)
    return json({ choices: [{ finish_reason: 'stop', message: { content: '结果' } }] })
  } })
  assert.equal(second.content, '结果'); assert.equal(messages.length, 1)
  assert.equal(await modelClient.complete({ baseUrl, model: 'writer', messages, fetchImpl: async () => json({ choices: [{ finish_reason: 'stop', message: { content: '旧文本' } }] }) }), '旧文本')
})

test('turn拒绝截断、缺失、重复ID或非法工具调用，不当最终文本成功', async () => {
  const options = { baseUrl, model: 'writer', messages: [], retryDelays: [] }
  const call = { id: '1', type: 'function', function: { name: 'read', arguments: '{}' } }
  for (const choice of [
    { finish_reason: 'length', message: { content: '半个结果' } },
    { finish_reason: 'tool_calls', message: { content: null } },
    { finish_reason: 'tool_calls', message: { tool_calls: [{ ...call, function: { name: 'read', arguments: {} } }] } },
    { finish_reason: 'tool_calls', message: { tool_calls: [call, call] } },
  ]) await assert.rejects(modelClient.turn({ ...options, fetchImpl: async () => json({ choices: [choice] }) }))
})
