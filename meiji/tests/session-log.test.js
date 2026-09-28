import test from 'node:test'
import assert from 'node:assert/strict'
import { insertSessionLog, runWithSessionLog } from '../server/host/session-log.js'
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

test('the first log opens an empty turn so a blank harness session shows the command', () => {
  const events = []
  const session = {
    snapshotEvents: () => events.slice(),
    append: (type, data) => { events.push({ type, data }) },
  }
  insertSessionLog(session, '已创建短剧')
  assert.deepEqual(events.map(event => event.type), ['turn/start', 'turn/end', 'command/run', 'command/done'])
  assert.deepEqual(events[0].data, { turn: 1 })
  assert.equal(events[1].data.reason.kind, 'completed')
  insertSessionLog(session, '已添加剧集')
  assert.equal(events.filter(event => event.type === 'turn/start').length, 1)
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

test('submission log preserves the complete messages and request options sent to the server', async () => {
  const events = [], session = { append: (type, data) => events.push({ type, data }) }
  let sent
  await runWithSessionLog(session, () => completeChat({
    baseUrl: 'https://gateway.test/v1/', apiKey: 'secret-key', model: 'text-model',
    system: '技能与语言要求\n完整上下文', prompt: '上游内容\n人工意见', json: true,
    fetchImpl: async (url, options) => {
      sent = JSON.parse(options.body)
      return Response.json({ choices: [{ message: { content: '完成' } }] })
    },
  }))
  const log = events.find(e => e.data.text?.includes('参数：')).data.text
  assert.match(log, /请求地址：https:\/\/gateway.test\/v1\/chat\/completions/)
  assert.deepEqual(JSON.parse(log.split('参数：')[1]), sent)
  assert.equal('max_tokens' in sent, false)
  assert.equal(log.includes('secret-key'), false)
})

test('video submission and file upload logs omit base64 while preserving actual uploads', async () => {
  const { submitGatewayVideo, uploadGatewayFile } = await import('../server/generate/gateway.js')
  const events = [], session = { append: (type, data) => events.push({ type, data }) }
  const bytes = Buffer.from([0, 1, 2, 253, 254, 255])
  const reference = bytes.toString('base64')
  await runWithSessionLog(session, async () => {
    await submitGatewayVideo({ baseUrl: 'https://gateway.test/v1/', apiKey: 'secret-key', prompt: '生成视频', duration: 5, mode: 'first_frame', inputReference: reference,
      fetchImpl: async (url, options) => {
        assert.equal(JSON.parse(options.body).input_reference, reference)
        return Response.json({ id: 'video-id' })
      } })
    await uploadGatewayFile({ baseUrl: 'https://gateway.test/v1/', apiKey: 'secret-key', bytes, filename: 'frame.png', mime: 'image/png',
      fetchImpl: async (url, options) => {
        assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()), bytes)
        return Response.json({ id: 'file-id', url: 'https://files.test/frame.png' })
      } })
  })
  const logs = events.filter(e => e.data.text?.includes('参数：')).map(e => e.data.text)
  assert.equal(JSON.parse(logs[0].split('参数：')[1]).input_reference, `[base64 图片，${reference.length} 字符]`)
  const file = JSON.parse(logs[1].split('参数：')[1]).file
  assert.equal(file.filename, 'frame.png')
  assert.equal(file.mime, 'image/png')
  assert.equal(file.size, bytes.length)
  assert.equal('content' in file, false)
  assert.equal(logs.join('\n').includes(reference), false)
  assert.equal(logs.join('\n').includes('secret-key'), false)
})

test('generation, review, correction and re-review have distinct request and response titles', async () => {
  const { runTextWorkflow } = await import('../server/generate/text-workflow.js')
  const { buildTextPrompts } = await import('../server/prompts/text-prompts.js')
  const { episodeFixture } = await import('./fixtures/model.js')
  const events = [], replies = ['原文', 'FAIL\n动作缺失', '修订正文', 'PASS']
  await runWithSessionLog({ append: (type, data) => events.push({ type, data }) }, () => runTextWorkflow({
    prompts: buildTextPrompts({ skill: 'skill-jingtou-meimiao-seconds-generate', project: {}, instructions: '生成时间线' }), options: {
      project: episodeFixture(), route: { baseUrl: 'https://test/v1/', apiKey: 'secret', model: 'text' },
      fetchImpl: async () => Response.json({ choices: [{ message: { content: replies.shift() } }] }),
    },
  }))
  assert.deepEqual(events.filter(e => e.type === 'command/run').map(e => e.data.name),
    ['生成', '自审', '自动修订', '复审'].flatMap(stage => ['发起请求', '返回数据'].map(phase => `日志-每秒指令·${stage}-${phase}`)))
})
