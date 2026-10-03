import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome, setupModel } from './fixtures/model.js'
import { executionContext } from '../server/runtime/task-context.js'
import { recordStore, readNodePrompts, TASK_SCHEMA } from '../server/data/task-store.js'
import { runNode } from '../server/runtime/task-execution.js'
import { completeChat, generateGatewayImage, submitGatewayVideo } from '../server/gateway/model-gateway.js'
import { runTextRequest } from '../server/gateway/model-gateway.js'

const route = { baseUrl: 'https://gateway.test/v1', apiKey: 'secret-test-key', model: 'test-model' }
async function fixture(t, home = null, projectId = 'project') {
  home ||= await tempHome(t)
  const store = recordStore(home, projectId), taskId = 'task'
  await store.update('tasks', taskId, { schemaVersion: TASK_SCHEMA, id: taskId, projectId, episodeId: null, nodes: [] })
  const context = { store, home, taskId, projectId, operation: {}, nodes: [], scope: 'root', outputs: [], baselines: new Map() }
  return { context, store, home, projectId, taskId,
    run: fn => executionContext.run(context, fn),
    read: step => readNodePrompts(home, projectId, taskId, step.id) }
}

test('保存实际完整 messages，多次请求分开存储且列表只携带引用', async t => {
  const e = await fixture(t), sent = [], system = '规则'.repeat(15000) + '末尾规则'
  await e.run(() => runNode('generate', async () => {
    for (const prompt of ['首稿', '续传']) await completeChat({ ...route, system, prompt, fetchImpl: async (_url, options) => {
      const messages = JSON.parse(options.body).messages
      sent.push(messages)
      const [task] = await e.store.list()
      assert.equal((await e.read(task.nodes[0])).length, sent.length, '发出请求前已经落盘')
      return Response.json({ choices: [{ message: { content: '结果' } }] })
    } })
  }))
  const [task] = await e.store.list(), entries = await e.read(task.nodes[0])
  assert.deepEqual(entries.map(entry => entry.messages), sent)
  assert.deepEqual(task.nodes[0].prompts.map(ref => Object.keys(ref)), [['id', 'kind', 'createdAt'], ['id', 'kind', 'createdAt']])
  assert.ok(!JSON.stringify(entries).includes(route.apiKey))
})

test('请求失败仍可查看原提示词，自定义文本请求也记录且不重复', async t => {
  const e = await fixture(t)
  await assert.rejects(e.run(() => runNode('review', () => completeChat({ ...route, prompt: '失败审核原文', fetchImpl: async () => { throw new Error('断网') } }))), /断网/)
  assert.equal((await e.read(e.context.nodes[0]))[0].messages[0].content, '失败审核原文')
  await e.run(() => runNode('revise', () => runTextRequest({ system: '修订规则', user: '人工意见' }, { request: async () => '修订结果' })))
  const records = await e.read(e.context.nodes[1])
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].messages, [{ role: 'system', content: '修订规则' }, { role: 'user', content: '人工意见' }])
})

test('实际摘要生成、自审、修订、复审各记录一份完整提示词', async t => {
  const { runOperation } = await import('./fixtures/operation.js')
  const { generateEpisode } = await import('../server/flow/tasks/text/task-summary.js')
  const e = await setupModel(t), messages = []
  await runOperation(e.op('summary', {}), { home: e.home, generateEpisode: options => generateEpisode({ ...options, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    messages.push(body.messages)
    const content = !body.messages[0].content.includes('【本次审核协议】') ? JSON.stringify({ summary: '旅人进入庭院，发现门后有埋伏，决定先探明敌人的目的。', durationSeconds: 10 }) : messages.length === 2 ? reviewFail('缺少明确的危机') : reviewPass
    return Response.json({ choices: [{ message: { content } }] })
  } }) })
  const [task] = await recordStore(e.home, e.id).list()
  assert.deepEqual(task.nodes.map(step => step.kind), ['generate', 'review', 'revise', 're_review'])
  for (const [index, step] of task.nodes.entries()) {
    const entries = await readNodePrompts(e.home, e.id, task.id, step.id)
    assert.equal(entries.length, 1, '请求包装层与网关不重复记录')
    assert.deepEqual(entries[0].messages, messages[index])
  }
})

test('图片及视频保存最终 prompt，不保存参考图 Base64 或凭据', async t => {
  const e = await fixture(t), base64 = 'data:image/png;base64,cmVmZXJlbmNl'
  await e.run(() => runNode('image_generate', () => generateGatewayImage({ ...route, prompt: '人物完整提示词', referenceBase64: [base64], fetchImpl: async (_url, options) => {
    assert.equal(options.body.get('prompt'), '人物完整提示词')
    return Response.json({ data: [{ b64_json: 'AA==' }] })
  } })))
  await e.run(() => runNode('video_submit', () => submitGatewayVideo({ ...route, prompt: '视频完整提示词', referenceImages: [base64], fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).prompt, '视频完整提示词')
    return Response.json({ id: 'video-1' })
  } })))
  const entries = await e.store.list('prompts')
  assert.deepEqual(entries.map(entry => entry.prompt).sort(), ['人物完整提示词', '视频完整提示词'])
  assert.ok(!JSON.stringify(entries).includes(base64))
  assert.ok(!JSON.stringify(entries).includes(route.apiKey))
})

test('按任务与步骤验证归属；新建剧集后仍能查看，删除剧集一并删除提示词', async t => {
  const e = await fixture(t)
  await e.run(() => runNode('generate', () => runTextRequest({ user: '新集提示词' }, { request: async () => '结果' })))
  const step = e.context.nodes[0]
  await e.store.update('tasks', e.taskId, task => ({ ...task, episodeId: 'new-episode' }))
  assert.equal((await e.read(step))[0].messages[0].content, '新集提示词')
  await assert.rejects(readNodePrompts(e.home, e.projectId, e.taskId, 'wrong-step'), /步骤不存在/)
  await e.store.update('tasks', 'another', { schemaVersion: TASK_SCHEMA, id: 'another', projectId: e.projectId, nodes: [step] })
  await assert.rejects(readNodePrompts(e.home, e.projectId, 'another', step.id), /不属于当前步骤/)
  await e.store.update('tasks', 'legacy', { schemaVersion: TASK_SCHEMA, id: 'legacy', projectId: e.projectId, nodes: [{ id: 'legacy-step' }] })
  assert.deepEqual(await readNodePrompts(e.home, e.projectId, 'legacy', 'legacy-step'), [])
  await e.store.removeEpisode('new-episode')
  assert.deepEqual(await e.store.list('prompts'), [])
  assert.equal((await e.store.list()).length, 2)
})

test('提示词 HTTP 查询沿用会话项目授权并验证 taskId / nodeId', async t => {
  const { registerPanel } = await import('../server/http/panel-routes.js')
  const { linkStore } = await import('../server/data/workspace-links.js')
  const project = await setupModel(t), sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
  const e = await fixture(t, project.home, project.id)
  await e.run(() => runNode('generate', () => runTextRequest({ user: '授权可见提示词' }, { request: async () => '结果' })))
  await linkStore(e.home).selectProject(sessionId, project.id, project.store)
  let handler
  const legacyMessages = [{ role: 'system', content: '当时的规则' }, { role: 'user', content: '当时的完整提示词' }]
  const legacySession = { snapshotEvents: () => [
    { type: 'command/done', data: { text: `任务 ${e.taskId} 开始：episode-generate` } },
    { type: 'command/run', data: { commandId: 'legacy-request', name: '日志-摘要·生成-发起请求' } },
    { type: 'command/done', data: { commandId: 'legacy-request', text: '函数：completeChat\n参数：' + JSON.stringify({ messages: legacyMessages }) } },
    { type: 'command/done', data: { text: `任务 ${e.taskId} 执行结束：completed` } },
  ] }
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = e.home
  try { registerPanel({ sessions: new Map([[sessionId, legacySession]]), connection: { requestRejection: () => null }, webServer: { register: route => { handler = route.handler } }, effect: fn => fn(), on() {}, logger: { warn() {} } }) }
  finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous }
  const call = async params => {
    let status, value
    await handler({ method: 'GET', url: `/plugins/meiji/tasks/${e.taskId}/nodes/${params.nodeId ?? e.context.nodes[0].id}/prompts?` + new URLSearchParams({ projectId: e.projectId, sessionId, ...params }) }, {
      writeHead(code) { status = code }, end(text) { value = JSON.parse(text) },
    })
    return { status, value }
  }
  const result = await call({})
  assert.equal(result.status, 200)
  assert.equal(result.value.prompts[0].messages[0].content, '授权可见提示词')
  assert.ok((await call({ sessionId: 'unlinked' })).status >= 400)
  assert.equal((await call({ nodeId: 'wrong' })).status, 404)
  assert.ok((await call({ nodeId: '' })).status >= 400)
  await e.store.update('tasks', e.taskId, task => ({ ...task, sessionId, nodes: task.nodes.map(step => ({ ...step, prompts: [] })) }))
  const empty = await call({})
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.value.prompts, [])

})
