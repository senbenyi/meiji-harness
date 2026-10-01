import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewResult, reviewProtocol, formatReviewIssue } from '../shared/review-result.js'
import { buildTextPrompts, buildEditedContentReview } from '../server/prompts/text-prompts.js'
import { buildStoryPrompts } from '../server/prompts/story-prompts.js'
import { reviewStep, runTextSteps } from '../server/generate/text-steps.js'
import { episodeFixture } from './fixtures/model.js'
import { reviewPass } from './fixtures/review-result.js'

const issue = { location: 'S01', reason: '方向与上游相反', requirement: '保留向北移动' }
test('strict review contract accepts only consistent structured verdicts', () => {
  assert.deepEqual(parseReviewResult(reviewPass), { passed: true, issues: [] })
  assert.deepEqual(parseReviewResult(JSON.stringify({ passed: false, issues: [issue] })), { passed: false, issues: [issue] })
  for (const invalid of ['PASS', 'FAIL 原因', '{}', 'null', '[]', '```json\n'+reviewPass+'\n```',
    JSON.stringify({ passed: 'true', issues: [] }), JSON.stringify({ passed: false, issues: [] }),
    JSON.stringify({ passed: true, issues: [issue] }), JSON.stringify({ passed: true, issues: [], extra: 1 }),
    ...['location', 'reason', 'requirement'].flatMap(key => [JSON.stringify({ passed: false, issues: [{ ...issue, [key]: '' }] }), JSON.stringify({ passed: false, issues: [{ ...issue, [key]: null }] })]),
    JSON.stringify({ passed: false, issues: [{ ...issue, extra: true }] }),
  ]) assert.throws(() => parseReviewResult(invalid), /审核返回格式错误/)
})

test('every review entry uses the one JSON protocol in its real API request', async () => {
  const project = episodeFixture()
  const prompts = ['episode', 'outline', 'shots', 'shot-revise', 'seconds', 'image-prompt']
    .map(skill => buildTextPrompts({ skill, project, instructions: '输入资料' }).review('待审正文'))
  prompts.push(buildTextPrompts({ skill: 'seconds', project, shotId: 'S01' }).review('单镜正文'))
  for (const kind of ['outline', 'characters', 'scenes', 'props']) prompts.push(buildStoryPrompts(project, kind).review('待审资料'))
  prompts.push(buildEditedContentReview({ project, stage: 'outline' }, '编辑正文'))
  prompts.push(buildEditedContentReview({ project, stage: 'storyboard', shotId: 'S01' }, '编辑正文'))
  for (const message of prompts) {
    assert.equal(message.json, true)
    assert.equal(message.system.split(reviewProtocol).length - 1, 1)
    assert.doesNotMatch(message.system + message.user, /PASS|FAIL/)
    await reviewStep({ message, options: { route: { baseUrl: 'https://test/v1', apiKey: 'test', model: 'test' }, fetchImpl: async (_, options) => {
      assert.deepEqual(JSON.parse(options.body).response_format, { type: 'json_object' })
      return Response.json({ choices: [{ message: { content: reviewPass } }] })
    } } })
  }
})

test('issues and deterministic failures drive one revision and remain readable', async () => {
  const prompts = buildTextPrompts({ skill: 'seconds', project: episodeFixture() })
  const messages = [], saved = []
  const replies = ['初稿', JSON.stringify({ passed: false, issues: [issue] }), '修订稿', reviewPass]
  const result = await runTextSteps({ prompts, retainFailedDraft: true, options: { request: async message => { messages.push(message); return replies.shift() } },
    check: text => text === '初稿' ? ['缺少结束标记'] : [], persist: (text, check) => saved.push({ text, check }),
  })
  assert.equal(messages.length, 4)
  assert.match(messages[2].user, /"location":"S01"/)
  assert.match(messages[2].user, /缺少结束标记/)
  assert.match(messages[3].user, /修订稿/)
  assert.equal(result.check.passed, true)
  assert.equal(saved[1].check.failures[0], formatReviewIssue(issue))
  assert.match(saved[1].check.failures[1], /位置：程序校验/)
})

test('invalid JSON review preserves saved draft without correction or false verdict', async () => {
  const saved = [], messages = []
  await assert.rejects(runTextSteps({ prompts: buildTextPrompts({ skill: 'seconds', project: episodeFixture() }),
    options: { request: async message => { messages.push(message); return message.skill === 'review' ? '{"passed":true,"issues":[{}]}' : '生成稿' } },
    persist: (text, check) => saved.push({ text, check }),
  }), /审核返回格式错误/)
  assert.equal(messages.length, 2)
  assert.deepEqual(saved, [{ text: '生成稿', check: { passed: null, failures: [] } }])
})

for (const program of [false, true]) for (const model of [false, true]) test(`review sources are optional per flow: program=${program}, model=${model}`, async () => {
 let programCalls = 0, modelCalls = 0
 const saved = []
 const result = await runTextSteps({
  prompts: { generation: { skill: 'seconds', user: '生成' }, ...(model ? { review: text => ({ skill: 'review', user: text }) } : {}) },
  ...(program ? { check: () => { programCalls++; return [] } } : {}),
  options: { request: async m => { if (m.skill === 'review') { modelCalls++; return reviewPass } return '正文' } },
  persist: (text, check) => { saved.push({ text, check }) },
 })
 assert.equal(modelCalls, model ? 1 : 0)
 assert.equal(programCalls > 0, program)
 assert.equal(result.check.passed, program || model ? true : null)
 assert.equal(saved.at(-1).check.passed, result.check.passed)
})

test('program-only rejection can revise without a model-review request', async () => {
 let generations = 0
 const result = await runTextSteps({
  prompts: { generation: { skill: 'seconds' }, revision: (text, opinion) => { assert.match(opinion, /缺少第二镜/); return { skill: 'seconds' } } },
  check: text => { if (text === '缺镜') throw new Error('缺少第二镜'); return [] },
  options: { request: async () => ++generations === 1 ? '缺镜' : '完整' },
 })
 assert.equal(generations, 2)
 assert.equal(result.check.passed, true)
})

test('a rejecting reviewer without revision configured does not invent a revision call', async () => {
 let requests = 0
 const result = await runTextSteps({ prompts: { generation: { skill: 'seconds' } }, check: () => ['需要调整'], retainFailedDraft: true,
  options: { request: async () => { requests++; return '正文' } },
 })
 assert.equal(requests, 1)
 assert.equal(result.check.passed, false)
})

test('no reviewers record no review step or verdict', async () => {
 const { recordSteps } = await import('./fixtures/steps.js')
 const { result, steps } = await recordSteps(() => runTextSteps({ prompts: { generation: { skill: 'seconds', user: '生成正文' } }, options: { request: async () => '正文' } }))
 assert.deepEqual(steps.map(s => s.kind), ['generate'])
 assert.equal(result.check.passed, null)
 assert.equal((await reviewStep({})).check.passed, null)
})
