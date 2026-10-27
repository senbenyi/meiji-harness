import test from 'node:test'
import assert from 'node:assert/strict'
import { runBoxModelTurn } from '../src/node_runtime/box_model_runner.js'
import { createNode } from '../src/node_runtime/node_initializer.js'
import { nodeRules } from '../src/node_runtime/node_state.js'
import { parseNodeOutput } from '../src/node_runtime/output_response_parser.js'

const call = (name, args = {}, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const reply = (...calls) => ({ role: 'assistant', content: null, tool_calls: calls })
async function fixture(action = 'generate', overrides = {}) {
  const node = await createNode('group_setting'), rules = nodeRules(node.node_state)
  const prior = [], requests = [], controller = new AbortController()
  let phaseMetadata = {}, number = 0
  const input = { story_outline: { segments: [{ id: 'seg_01', body: 'SOURCE_SECRET_42' }] }, current_groups: { groups: [] }, output_language: 'zh-CN', instruction: '生成或核对团队' }
  if (action !== 'generate') input.review_issues = [{ location: 'groups', reason: 'OLD_ISSUE_42', suggestion: '核对' }]
  const options = { nodeType: 'group_setting', action, input, rules, config: { baseUrl: 'http://local/v1', text: { model: 'test' } }, goal: input.instruction,
    validate: value => parseNodeOutput('group_setting', action, value), ...overrides }
  return { prior, requests, rules, input, controller,
    async turn(response, extra = {}) {
      let prompt
      const ctx = { step: { id: `step_${++number}`, kind: action, round: 0, name: action, metadata: phaseMetadata }, previousResults: structuredClone(prior), signal: controller.signal, recordPrompt: p => { assert.equal(prompt, undefined); prompt = structuredClone(p) } }
      const result = await runBoxModelTurn({ ...options, ...extra, ctx, client: { async turn(request) { requests.push(request); return typeof response === 'function' ? response(request) : response } } })
      const saved = { id: ctx.step.id, kind: action, round: 0, step_status: 'completed', prompt, result: result.pending?.result || { box_turn: result.trace } }
      prior.push(saved)
      if (result.pending) phaseMetadata = result.pending.nextSteps[0].metadata
      return result
    },
  }
}
function reads(f, action, { skip = [] } = {}) {
  const catalog = JSON.parse(f.requests[0].messages[1].content)
  return reply(...catalog.skills.filter(row => row.required && !skip.includes(row.name)).map(row => call('read_skill', { name: row.name }, row.name)),
    ...catalog.materials.filter(row => row.required && !skip.includes(row.name)).map(row => call('read_material', { name: row.name }, row.name)), call('read_contract'))
}

test('首轮仅目标和索引；模型第二轮自主读取，第三轮提交，完整原生消息续接', async () => {
  const f = await fixture()
  const first = await f.turn({ role: 'assistant', content: '{"groups":[]}' })
  assert.ok(first.pending, '不能在未读取依据时直接提交')
  const raw = JSON.stringify(f.requests[0].messages)
  assert.doesNotMatch(raw, /SOURCE_SECRET_42|以本次story_outline|字段处理方法/)
  assert.equal(f.requests[0].tools.find(row => row.function.name === 'submit_review'), undefined)
  await f.turn(reads(f, 'generate'))
  const done = await f.turn(reply(call('submit_candidate', { output: { groups: [] } })))
  assert.deepEqual(done.output, { groups: [] })
  assert.ok(f.requests[2].messages.some(row => row.role === 'tool' && row.content.includes('SOURCE_SECRET_42')))
  assert.equal(f.requests.length, f.prior.length)
  assert.equal(new Set(f.requests.map(row => row.requestId)).size, 3)
  const story = await createNode('story_segments')
  const audit = await fixture('review', { nodeType: 'story_segments', rules: nodeRules(story.node_state), input: { current_outline: { segments: [{ id: 'seg_123', body: '当前候选' }] }, basic_info: { actual_script: '工作正文' } } })
  await audit.turn(reply(call('read_skill', { name: 'drama-story-segments-review-scope' })))
  assert.equal(JSON.parse(audit.requests[0].messages[1].content).skills.find(row => row.name === 'drama-story-segments-review-scope').required, true)
  assert.match(audit.prior[0].result.box_turn.messages[1].content, /全部1个故事段.*seg_123/)
})

test('审核必须读完最新候选和全部旧问题，不能提交正文；作者会话不自动进入审核', async () => {
  const f = await fixture('review')
  f.prior.push({ id: 'author', kind: 'generate', prompt: { messages: [{ role: 'assistant', content: 'AUTHOR_SECRET' }] }, result: { output: { groups: [] } } })
  await f.turn(reply(call('submit_candidate', { output: { groups: [] } })))
  assert.doesNotMatch(JSON.stringify(f.requests[0].messages), /AUTHOR_SECRET|OLD_ISSUE_42|SOURCE_SECRET_42/)
  assert.match(f.prior.at(-1).result.box_turn.messages.at(-1).content, /不允许/)
  await f.turn(reads(f, 'review', { skip: ['review_issues'] }))
  await f.turn(reply(call('submit_review', { output: { status: 'passed', issues: [] } })))
  assert.match(f.prior.at(-1).result.box_turn.messages.at(-1).content, /material:review_issues/)
  await f.turn(reply(call('read_material', { name: 'review_issues' })))
  assert.equal((await f.turn(reply(call('submit_review', { output: { status: 'passed', issues: [] } })))).output.status, 'passed')
})

test('修改完整读取当前基稿及意见后仍可保留有效内容；旧意见不会成为必执行的指令', async () => {
  const f = await fixture('revise')
  await f.turn(reply(call('read_material', { name: 'current_groups', pointer: '/groups' })))
  await f.turn(reads(f, 'revise', { skip: ['current_groups'] }))
  const pending = await f.turn(reply(call('submit_candidate', { output: { groups: [] } })))
  assert.ok(pending.pending, '局部读取不等于读完当前完整基稿')
  await f.turn(reply(call('read_material', { name: 'current_groups' })))
  assert.deepEqual((await f.turn(reply(call('submit_candidate', { output: { groups: [] } })))).output, { groups: [] })
})

test('无效审核输出只反馈同阶段，不能变成正文候选；达到独立修复预算明确失败', async () => {
  const f = await fixture('review')
  await f.turn({ role: 'assistant', content: '先读取' })
  await f.turn(reads(f, 'review'))
  const bad = reply(call('submit_review', { output: { status: 'passed', issues: [{ reason: '无据' }] } }))
  const result = await f.turn(bad)
  assert.ok(result.pending)
  assert.equal(result.pending.result.box_turn.validation_error.code, 'INVALID_NODE_OUTPUT')
  assert.equal(result.pending.nextSteps[0].kind, 'review')
  await f.turn(bad)
  await assert.rejects(f.turn(bad), /审核输出修复次数已用尽/)
})

test('只读工具拒绝其他盒子skill、越界资料/记录与额外参数', async () => {
  const f = await fixture()
  const result = await f.turn(reply(call('read_skill', { name: '../../scene_image' }), call('read_material', { name: 'outside' }), call('read_material', { name: 'story_outline', pointer: '/__proto__' }, 'prototype'), call('read_execution', { step_id: 'other-task' }), call('read_contract', { override: true })))
  const messages = result.pending.result.box_turn.messages.filter(row => row.role === 'tool')
  assert.equal(messages.length, 5)
  assert.ok(messages.every(row => JSON.parse(row.content).error))
})

test('项目私有规则与补充规则只作为索引出现，必须读取且不被默认skill覆盖', async () => {
  const f = await fixture()
  f.rules.rules.generate.base = 'PRIVATE_RULE_SECRET'
  f.rules.rules.generate.supplement = 'SUPPLEMENT_SECRET'
  await f.turn({ role: 'assistant', content: '读取规则' })
  const catalog = JSON.parse(f.requests[0].messages[1].content)
  assert.ok(catalog.skills.find(row => row.name === 'project-base').required)
  assert.doesNotMatch(JSON.stringify(f.requests[0].messages), /PRIVATE_RULE_SECRET|SUPPLEMENT_SECRET/)
  await f.turn(reads(f, 'generate', { skip: ['project-supplement'] }))
  assert.ok((await f.turn(reply(call('submit_candidate', { output: { groups: [] } })))).pending)
  await f.turn(reply(call('read_skill', { name: 'project-supplement' })))
  assert.deepEqual((await f.turn(reply(call('submit_candidate', { output: { groups: [] } })))).output, { groups: [] })
  assert.equal(f.rules.rules.generate.base, 'PRIVATE_RULE_SECRET')
})

test('循环预算、模型传输错误和取消不会被当成内容问题继续修订', async () => {
  const f = await fixture()
  await f.turn(reply(call('read_material', { name: 'unknown' })))
  await assert.rejects(f.turn(reply(call('read_contract')), { maxTurns: 1 }), { code: 'BOX_TURN_LIMIT' })
  const g = await fixture(), error = Object.assign(new Error('连接失败'), { code: 'NETWORK_CONNECTION_FAILED' })
  await assert.rejects(g.turn(() => { throw error }), thrown => thrown === error)
  assert.equal(g.prior.length, 0)
  const h = await fixture()
  await assert.rejects(h.turn(() => { h.controller.abort(new Error('用户取消')); return reply(call('submit_candidate', { output: { groups: [] } })) }), /用户取消/)
  assert.equal(h.prior.length, 0)
})
