import test from 'node:test'
import assert from 'node:assert/strict'
import { insertSessionLog, runWithSessionLog } from '../server/flow/session-log.js'
import { completeChat } from '../server/generate/gateway.js'

test('a session log is a command record and not a model message', () => {
  const events = []
  const session = { append: (type, data) => { events.push({ type, data }) } }
  insertSessionLog(session, '已写好大纲\n角色之后会清空')
  assert.deepEqual(events.map(event => event.type), ['command/run', 'command/done'])
  assert.equal(events[0].data.name, '日志')
  assert.equal(events[1].data.kind, 'success')
  assert.match(events[1].data.text, /已写好大纲/)
  assert.equal(events[0].data.commandId, events[1].data.commandId)
  assert.equal(events.some(event => event.type === 'user/message'), false)
})

test('an API call logs the path, headers and body without the key', async () => {
  const events = []
  const session = { append: (type, data) => { events.push({ type, data }) } }
  const text = await runWithSessionLog(session, () => completeChat({
    baseUrl: 'http://gateway.test/v1',
    apiKey: 'sk-secret',
    model: 'elysium-chat',
    prompt: '写一句',
    fetchImpl: async () => Response.json({ choices: [{ message: { content: '好' } }] }, { status: 200 }),
  }))
  assert.equal(text, '好')
  const logs = events.filter(event => event.type === 'command/done').map(event => event.data.text)
  assert.equal(logs.length, 2)
  assert.match(logs[0], /函数：completeChat/)
  assert.match(logs[0], /POST \/v1\/chat\/completions/)
  assert.match(logs[0], /请求头：/)
  assert.match(logs[0], /Content-Type/)
  assert.match(logs[0], /参数：/)
  assert.match(logs[0], /写一句/)
  assert.equal(logs[0].includes('返回：'), false)
  assert.match(logs[1], /函数：completeChat/)
  assert.match(logs[1], /返回：/)
  assert.match(logs[1], /"content":"好"/)
  assert.equal(logs[1].includes('写一句'), false)
  assert.equal(logs.join('\n').includes('sk-secret'), false)
})
