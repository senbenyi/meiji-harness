import { reviewPass, reviewFail } from './fixtures/review-result.js'
// 实际请求在发出前按 runId + stepId 保存；步骤只带引用，不含密钥与参考图 Base64。
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { runContext } from './fixtures/run-context.js'
import { runNode } from '../server/runtime/step-execution.js'
import { completeChat, generateGatewayImage, submitGatewayVideo, runTextRequest } from '../server/gateway/model-gateway.js'

const route = { baseUrl: 'https://gateway.test/v1', apiKey: 'secret-test-key', model: 'test-model' }

test('保存实际完整 messages，多次请求分开存储且步骤只携带引用', async t => {
  const e = await runContext(t), sent = [], system = '规则'.repeat(15000) + '末尾规则'
  await e.run(() => runNode('generate', async () => {
    for (const prompt of ['首稿', '续传']) await completeChat({ ...route, system, prompt, fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body).messages)
      assert.equal((await e.read('prompts')).length, sent.length, '发出请求前已经落盘')
      return Response.json({ choices: [{ message: { content: '结果' } }] })
    } })
  }))
  const entries = await e.read('prompts'), run = await e.store.read(e.runId)
  assert.deepEqual(entries.map(entry => entry.messages), sent)
  assert.deepEqual(run.steps[0].prompts, entries.map(entry => entry.id))
  assert.ok(entries.every(entry => entry.runId === e.runId && entry.stepId === e.stepId))
  assert.ok(!JSON.stringify(entries).includes(route.apiKey))
  assert.ok(!JSON.stringify(run).includes('末尾规则'), '任务记录不携带提示词正文')
})

test('请求失败仍可查看原提示词，自定义文本请求也记录且不重复', async t => {
  const e = await runContext(t, { kind: 'review' })
  await assert.rejects(e.run(() => runNode('review', () => completeChat({ ...route, prompt: '失败审核原文', fetchImpl: async () => { throw new Error('断网') } }))), /断网/)
  assert.equal((await e.read('prompts'))[0].messages[0].content, '失败审核原文')
  await e.run(() => runNode('revise', () => runTextRequest({ system: '修订规则', user: '人工意见' }, { request: async () => '修订结果' })))
  const records = await e.read('prompts')
  assert.equal(records.length, 2)
  assert.deepEqual(records[1].messages, [{ role: 'system', content: '修订规则' }, { role: 'user', content: '人工意见' }])
})

test('实际摘要生成、自审、修订、复审各在自己的步骤记录一份完整提示词', async t => {
  const { runOperation, latestRun } = await import('./fixtures/operation.js')
  const { runStore } = await import('../server/data/run-store.js')
  const e = await setupModel(t), messages = []
  await runOperation(e.op('summary', {}), { home: e.home, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    messages.push(body.messages)
    const content = !body.messages[0].content.includes('【本次审核协议】') ? JSON.stringify({ summary: '旅人进入庭院，发现门后有埋伏，决定先探明敌人的目的。', durationSeconds: 10 }) : messages.length === 2 ? reviewFail('缺少明确的危机') : reviewPass
    return Response.json({ choices: [{ message: { content } }] })
  } })
  const run = await latestRun(e.home, e.id, 'summary')
  assert.deepEqual(run.kinds, ['generate', 'review', 'revise', 're_review'])
  for (const [index, step] of run.steps.entries()) {
    const entries = await runStore(e.home, e.id).records(run.id, step.id, 'prompts')
    assert.equal(entries.length, 1, '请求包装层与网关不重复记录')
    assert.deepEqual(entries[0].messages, messages[index])
  }
})

test('图片及视频保存最终 prompt，不保存参考图 Base64 或凭据', async t => {
  const e = await runContext(t, { kind: 'image' }), base64 = 'data:image/png;base64,cmVmZXJlbmNl'
  await e.run(() => runNode('image_generate', () => generateGatewayImage({ ...route, prompt: '人物完整提示词', referenceBase64: [base64], fetchImpl: async (_url, options) => {
    assert.equal(options.body.get('prompt'), '人物完整提示词')
    return Response.json({ data: [{ b64_json: 'AA==' }] })
  } })))
  await e.run(() => runNode('video_submit', () => submitGatewayVideo({ ...route, prompt: '视频完整提示词', referenceImages: [base64], fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).prompt, '视频完整提示词')
    return Response.json({ id: 'video-1' })
  } })))
  const entries = await e.store.listRecords('prompts')
  assert.deepEqual(entries.map(entry => entry.prompt).sort(), ['人物完整提示词', '视频完整提示词'])
  assert.ok(!JSON.stringify(entries).includes(base64))
  assert.ok(!JSON.stringify(entries).includes(route.apiKey))
})

test('按任务与步骤验证归属；删除剧集一并删除提示词', async t => {
  const e = await runContext(t, { episodeId: 'new-episode' })
  await e.run(() => runNode('generate', () => runTextRequest({ user: '新集提示词' }, { request: async () => '结果' })))
  assert.equal((await e.read('prompts'))[0].messages[0].content, '新集提示词')
  await assert.rejects(e.store.records(e.runId, 'wrong-step', 'prompts'), { status: 404 })
  await assert.rejects(e.store.records('wrong-run', e.stepId, 'prompts'), { status: 404 })
  await e.store.removeEpisode('new-episode')
  assert.deepEqual(await e.store.listRecords('prompts'), [])
  assert.deepEqual(await e.store.list(), [])
})
