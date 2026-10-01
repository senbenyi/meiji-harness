import test from 'node:test'
import assert from 'node:assert/strict'
import { stepPromptsFromLog } from '../server/host/step-prompt-log.js'

const steps = ['generate', 'review', 'revise', 're_review', 'image_generate', 'video_submit'].map(kind => ({ id: kind, kind }))
const task = { id: 'task', steps }
const boundary = text => ({ type: 'command/done', data: { text } })
const request = (phase, body, fn = 'completeChat', id = phase) => [
  { type: 'command/run', data: { commandId: id, name: `日志-摘要·${phase}-发起请求` } },
  { type: 'command/done', data: { commandId: id, text: `函数：${fn}\n请求头：{"Authorization":"[已隐藏]"}\n参数：${JSON.stringify(body)}` } },
]
const session = events => ({ snapshotEvents: () => events })

test('旧请求按任务边界与唯一类型提取完整生成、审核、修订及复审', () => {
  const messages = [{ role: 'system', content: '规则'.repeat(16000) }, { role: 'user', content: '全文' }]
  const events = [boundary('任务 other 开始：outline'), ...request('生成', { messages: [{ role: 'user', content: '他人请求' }] }), boundary('任务 other 执行结束：completed'), boundary('任务 task 开始：outline')]
  for (const phase of ['生成', '自审', '自动修订', '复审']) events.push(...request(phase, { messages }))
  events.push(boundary('任务 task 执行结束：completed'))
  for (const step of steps.slice(0, 4)) assert.deepEqual(stepPromptsFromLog(session(events), task, step), [{ kind: 'text', messages }])
})

test('同会话并发、重复步骤种类、无边界或无会话不推测归属', () => {
  const call = request('生成', { messages: [{ role: 'user', content: '不能归属' }] })
  assert.deepEqual(stepPromptsFromLog(session(call), task, steps[0]), [])
  assert.deepEqual(stepPromptsFromLog(null, task, steps[0]), [])
  const events = [boundary('任务 task 开始：outline'), ...call, boundary('任务 concurrent 开始：outline'), boundary('任务 concurrent 执行结束：completed'), boundary('任务 task 执行结束：completed')]
  assert.deepEqual(stepPromptsFromLog(session(events), task, steps[0]), [])
  assert.deepEqual(stepPromptsFromLog(session([boundary('任务 task 开始：outline'), ...call]), { ...task, steps: [steps[0], { ...steps[0], id: 'second' }] }, steps[0]), [])
})

test('仅返回图片/视频 prompt，忽略参考图、凭据、不完整 JSON 和响应', () => {
  const events = [boundary('任务 task 开始：film'),
    ...request('生成', { prompt: '完整图片提示词', reference_images: ['base64-data'], apiKey: 'secret' }, 'generateGatewayImage', 'image'),
    ...request('生成', { prompt: '完整视频提示词', input_reference: 'base64-data' }, 'submitGatewayVideo', 'video'),
    ...request('生成', { messages: [{ role: 'user', content: '响应不是提示词' }] }, 'retrieveGatewayVideo'),
    ...request('生成', { messages: [{ role: 'user', content: '损坏正文' }] }, 'completeChat', 'invalid')]
  events.at(-1).data.text = '函数：completeChat\n参数：{"messages":'
  assert.deepEqual(stepPromptsFromLog(session(events), task, steps[0]), [])
  assert.deepEqual(stepPromptsFromLog(session(events), task, steps[4]), [{ kind: 'image', prompt: '完整图片提示词' }])
  assert.deepEqual(stepPromptsFromLog(session(events), task, steps[5]), [{ kind: 'video', prompt: '完整视频提示词' }])
})
