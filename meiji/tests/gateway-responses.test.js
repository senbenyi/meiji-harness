import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './fixtures/model.js'
import { executionContext } from '../server/runtime/task-context.js'
import { recordStore, readNodeResponses, TASK_SCHEMA } from '../server/data/task-store.js'
import { runNode, recordNodeResponse } from '../server/runtime/task-execution.js'
import { completeChat, retrieveGatewayVideo, generateGatewayImage } from '../server/gateway/model-gateway.js'
import { redactJson } from '../server/gateway/redact.js'

const route = { baseUrl: 'https://gateway.test/v1', apiKey: 'secret-test-key', model: 'test-model' }
async function fixture(t) {
  const home = await tempHome(t), store = recordStore(home, 'project'), taskId = 'task'
  await store.update('tasks', taskId, { schemaVersion: TASK_SCHEMA, id: taskId, projectId: 'project', episodeId: 'episode', nodes: [] })
  const context = { store, home, taskId, projectId: 'project', operation: { episodeId: 'episode' }, nodes: [], scope: 'root', outputs: [], baselines: new Map() }
  return { context, store, home, run: fn => executionContext.run(context, () => runNode('generate', fn)), read: () => readNodeResponses(home, 'project', taskId, context.nodes[0].id) }
}

test('成功与错误原文完整记录，列表只有引用，密钥和 Base64 脱敏', async t => {
  const e = await fixture(t), data = { choices: [{ message: { content: '结果' } }], api_key: route.apiKey, b64_json: 'QUJD', nested: `data:image/png;base64,QUJD ${route.apiKey}` }
  await e.run(() => completeChat({ ...route, prompt: '输入', fetchImpl: async () => Response.json(data) }))
  const entries = await e.read()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].body.choices[0].message.content, '结果')
  assert.equal(entries[0].status, 200)
  assert.equal(entries[0].episodeId, 'episode')
  assert.ok(entries[0].durationMs >= 0)
  assert.doesNotMatch(JSON.stringify(entries), /secret-test-key|QUJD/)
  assert.equal(e.context.nodes[0].responses[0].body, undefined)
  await assert.rejects(readNodeResponses(e.home, 'project', 'task', 'other'), { status: 404 })
  await e.store.update('responses', entries[0].id, { ...entries[0], taskId: 'other' })
  await assert.rejects(e.read(), { status: 404 })
})

test('非 2xx 和非 JSON 返回不丢失，网络异常也记录', async t => {
  for (const response of [Response.json({ error: { message: '坏请求' } }, { status: 400 }), new Response('完整错误原文'.repeat(100), { status: 502 })]) {
    const e = await fixture(t)
    await assert.rejects(e.run(() => completeChat({ ...route, prompt: '输入', fetchImpl: async () => response })))
    const [entry] = await e.read()
    assert.equal(entry.ok, false)
    assert.equal(typeof entry.body === 'string' ? entry.body.length : entry.body.error.message, typeof entry.body === 'string' ? 600 : '坏请求')
  }
  const e = await fixture(t)
  await assert.rejects(e.run(() => completeChat({ ...route, prompt: '输入', fetchImpl: async () => { throw new Error(`断网 ${route.apiKey}`) } })))
  assert.match((await e.read())[0].error, /断网/)
  assert.doesNotMatch((await e.read())[0].error, /secret-test-key/)
})

test('视频轮询只保存终态与下载字节数，中间查询不记录', async t => {
  const e = await fixture(t); let polls = 0
  const bytes = await e.run(() => retrieveGatewayVideo({ ...route, promptId: 'video', pause: async () => {}, fetchImpl: async url => {
    if (url.pathname.endsWith('/content')) return new Response('video-bytes')
    return Response.json({ status: ++polls === 3 ? 'completed' : 'processing' })
  } }))
  assert.equal(bytes.length, 11)
  const entries = await e.read()
  assert.equal(entries.length, 2)
  assert.equal(entries[0].body.status, 'completed')
  assert.equal(entries[1].bytes, 11)
  await e.store.removeEpisode('episode')
  assert.deepEqual(await e.store.list('responses'), [])
})

test('轮询超时保存最后一次，记录写入失败不改变业务结果，无上下文不写入', async t => {
  const e = await fixture(t)
  await assert.rejects(e.run(() => retrieveGatewayVideo({ ...route, promptId: 'video', pause: async () => {}, maxPolls: 2, fetchImpl: async () => Response.json({ status: 'processing' }) })), /超时/)
  assert.equal((await e.read()).length, 1)
  await recordNodeResponse({ fn: 'outside' })
  assert.equal((await e.store.list('responses')).length, 1)
  e.store.update = async () => { throw new Error('记录磁盘失败') }
  await executionContext.run(e.context, () => recordNodeResponse({ fn: 'safe' }))
  assert.deepEqual(redactJson({ authorization: 'Bearer key', data: 'data:video/mp4;base64,QUJD' }), { authorization: '[已隐藏]', data: '[base64 数据，4 字符]' })
})


test('响应正文读取失败仍保存 HTTP 状态和脱敏异常', async t => {
  const e = await fixture(t)
  await assert.rejects(e.run(() => completeChat({ ...route, prompt: '输入', fetchImpl: async () => ({ ok: true, status: 200, text: async () => { throw new Error(`响应中断 ${route.apiKey}`) } }) })), /响应中断/)
  const [entry] = await e.read()
  assert.equal(entry.status, 200); assert.equal(entry.ok, false); assert.match(entry.error, /响应中断/); assert.doesNotMatch(entry.error, /secret-test-key/)
})
