import test from 'node:test'
import assert from 'node:assert/strict'
import { parseShotReview } from '../src/node_box/shot_design/review_validation.js'
import { parseNodeOutput } from '../src/node_runtime/output_response_parser.js'
import { composeNodePrompt } from '../src/node_runtime/node_prompt_composer.js'
import { createNode } from '../src/node_runtime/node_initializer.js'
import { nodeRules } from '../src/node_runtime/node_state.js'
import { renderNodeRules } from '../src/node_runtime/output_contract_renderer.js'

const input = () => ({
  story_outline: { segments: [{ body: '林说：“却胜万倍。”由午后推进至入夜，天空澄明。肉体可灰，精神不可懈怠。' }] },
  current_shots: { shots: [{ id: 'shot_001', beats: [{ action: '由午后推进至入夜，天空澄明。人物始终留在望远镜作业区。', audio: '林说：“却胜万万。”' }] }] }, previous_issues: [],
})
const rules = { rules: { review: { base: '只阻断有据硬错误', supplement: '' } } }
const blocker = () => ({ category: 'dialogue', location: 'shot_001.beats[0].audio', reason: '对白字词被改变', suggestion: '恢复大纲明确原话',
  source_path: '/story_outline/segments/0/body', source_quote: '却胜万倍。', candidate_path: '/current_shots/shots/0/beats/0/audio', candidate_quote: '却胜万万。', previous_issue_index: null })
const review = () => ({ status: 'content_issue', issues: [blocker()], suggestions: [], previous_issue_checks: [] })
const check = state => ({ issue_index: 0, state, reason: '以最新候选核对', candidate_path: '/current_shots/shots/0/beats/0/action', candidate_quote: '人物始终留在望远镜作业区。' })

test('分镜硬错误必须引用真实来源和当前候选；原文万倍不能被审核捏造成万万', () => {
  assert.deepEqual(parseShotReview(JSON.stringify(review()), input(), rules), review())
  const withQuotes = review(); withQuotes.issues[0].source_quote = '“却胜万倍。”'
  assert.equal(parseShotReview(withQuotes, input(), rules).status, 'content_issue', '引用保留原有引号也可核验')
  const script = input(); script.story_outline.segments[0].body = '林：却胜万倍。'
  assert.equal(parseShotReview(review(), script, rules).status, 'content_issue', '人物名加冒号的明确对白同样有效')
  const wrong = review(); wrong.issues[0].source_quote = '却胜万万。'
  assert.throws(() => parseShotReview(wrong, input(), rules), /引用不是当前原文/)
  wrong.issues[0] = { ...blocker(), candidate_quote: '返回客堂' }
  assert.throws(() => parseShotReview(wrong, input(), rules), /引用不是当前原文/)
  wrong.issues[0] = { ...blocker(), source_path: '/story_outline/segments/9/body' }
  assert.throws(() => parseShotReview(wrong, input(), rules), /路径不存在/)
  wrong.issues[0] = { ...blocker(), candidate_path: '/story_outline/segments/0/body' }
  assert.throws(() => parseShotReview(wrong, input(), rules), /路径不可用/)
})

test('已明确的时间推进不能称为遗漏，大纲间接概述不能要求臆造逐字对白', () => {
  const missing = review()
  missing.issues[0] = { ...blocker(), category: 'omission', source_quote: '由午后推进至入夜', candidate_path: '/current_shots/shots/0/beats/0/action', candidate_quote: '' }
  assert.throws(() => parseShotReview(missing, input(), rules), /原文已在当前候选中/)
  missing.issues[0].candidate_path = '/current_shots/shots/0/beats/0/audio'
  assert.throws(() => parseShotReview(missing, input(), rules), /不能要求跨字段重复表达/)
  const indirect = review(); indirect.issues[0].source_quote = '肉体可灰，精神不可懈怠'
  assert.throws(() => parseShotReview(indirect, input(), rules), /不能把概述当定稿原话/)
})

test('复审先完整核对旧问题；不能把已解决问题再次阻断或伪装成新问题', () => {
  const data = input(); data.previous_issues = [blocker()]
  assert.throws(() => parseShotReview(review(), data, rules), /逐项核对上一轮问题/)
  const current = review(); current.previous_issue_checks = [check('unresolved')]; current.issues[0].previous_issue_index = 0
  assert.equal(parseShotReview(current, data, rules).status, 'content_issue')
  current.previous_issue_checks[0].state = 'resolved'
  assert.throws(() => parseShotReview(current, data, rules), /已解决或不存在/)
  current.issues[0].previous_issue_index = null
  assert.throws(() => parseShotReview(current, data, rules), /伪装成新问题/)
  const passed = { status: 'passed', issues: [], suggestions: [], previous_issue_checks: [check('unresolved')] }
  assert.throws(() => parseShotReview(passed, data, rules), /必须给出本轮有据/)
  passed.previous_issue_checks[0].state = 'resolved'
  assert.equal(parseShotReview(passed, data, rules).status, 'passed', '允许根据最新证据撤回旧误报')
})

test('摄影与声音建议可随通过结果返回，其他盒子继续使用原审核契约', () => {
  const advice = { status: 'passed', issues: [], suggestions: [{ location: 'camera', reason: '可增加层次', suggestion: '可选增加特写' }], previous_issue_checks: [] }
  assert.deepEqual(parseShotReview(advice, input(), rules), advice)
  assert.throws(() => parseShotReview({ status: 'content_issue', issues: [{ location: 'camera', reason: '不够丰富', suggestion: '增加特写' }] }, input(), rules), { code: 'INVALID_NODE_OUTPUT' })
  assert.deepEqual(parseNodeOutput('scene_extraction', 'review', { status: 'passed', issues: [] }), { status: 'passed', issues: [] })
})

test('旧分镜规则引用兼容新审核结构；规则查看与实际提示词展示同一证据契约', async () => {
  const node = await createNode('shot_design')
  node.node_state.rules.review.base = '旧项目规则\n{{output:#/$defs/review_output}}'
  const model = nodeRules(node.node_state)
  const prompt = composeNodePrompt({ nodeType: 'shot_design', action: 'review', rules: model, input: input() })
  assert.match(prompt.system, /source_quote/); assert.match(prompt.system, /previous_issue_checks/)
  assert.match(renderNodeRules(model, 'review', { nodeType: 'shot_design' }).base, /source_quote/)
  assert.equal(node.node_state.rules.review.base, '旧项目规则\n{{output:#/$defs/review_output}}', '兼容引用不覆盖私有规则')
})
