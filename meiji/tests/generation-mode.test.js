import { operationRequest } from '../client/operation-request.js'
import { secondsResponse, secondsContent } from './fixtures/seconds.js'
import { reviewPass } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from './fixtures/operation.js'
import { generateShotSeconds } from '../server/flow/tasks/text/task-shot-seconds.js'
import { prepareChecks, withReviewPrompt } from '../server/runtime/review-checks.js'
import { checkContext } from '../server/runtime/operation-context.js'

for (const generationMode of ['regenerate', 'modify']) {
  test(`${generationMode} isolates old output and opinions while reviewing newest output`, async t => {
    const e = await setupModel(t), models = modelStore(e.home)
    await models.write({ ...await models.read(), apiKey: 'test-only' })
    await e.store.save(e.id, p => {
      const node = p.episodes[0].shots.items[0].seconds
      node.content = secondsContent('S01',5,'OLD_OUTPUT_MARKER'); node.review.text = 'OLD_HUMAN_MARKER'
      node.check = { passed: false, failures: ['OLD_CHECK_MARKER'] }
      return p
    })
    const calls = []
    await runOperation(e.op('seconds', { track: 'S01', generationMode }), { home: e.home,
      generateShotSeconds: options => generateShotSeconds({ ...options, request: async ({ skill, user: prompt }) => {
        calls.push({ skill, prompt }); return skill === 'review' ? reviewPass : secondsResponse([['S01',5,'NEW_OUTPUT_MARKER']])
      } }),
    })
    const generation = calls[0].prompt
    for (const marker of ['OLD_OUTPUT_MARKER', 'OLD_HUMAN_MARKER', 'OLD_CHECK_MARKER']) assert.equal(generation.includes(marker), generationMode === 'modify', marker)
    assert.match(calls[1].prompt, /【本次待审内容】[\s\S]*NEW_OUTPUT_MARKER/)
    if (generationMode === 'regenerate') assert.doesNotMatch(calls[1].prompt, /OLD_OUTPUT_MARKER/)
    else assert.match(calls[1].prompt, /【修订基稿（用于对照范围）】[\s\S]*OLD_OUTPUT_MARKER/)
    const node = (await e.read()).shots.items[0].seconds
    assert.equal(node.content.beats[0].action, 'NEW_OUTPUT_MARKER')
    assert.equal(node.review.text, generationMode === 'regenerate' ? 'OLD_HUMAN_MARKER' : '')
  })
}

test('modify rejects missing original or missing opinion before saving', async t => {
  const e = await setupModel(t)
  const project = await e.read()
  const store = { save() { assert.fail('invalid modification must not save') } }
  await assert.rejects(prepareChecks(store, project, { action: 'shot-seconds', ...{ track: 'S01', generationMode: 'modify' } }), /修改需要/)
  project.shots.items[0].seconds.content = null
  await assert.rejects(prepareChecks(store, project, { action: 'shot-seconds', ...{ track: 'S01', generationMode: 'modify', review: '修改方向' } }), /修改需要/)
})

test('media modifications carry original submitted prompt; reviews exclude it', () => {
  checkContext.run({ review: '修改光线', originalCandidate: { prompt: 'ORIGINAL_MEDIA_PROMPT' } }, () => {
    assert.match(withReviewPrompt('本次要求'), /ORIGINAL_MEDIA_PROMPT/)
    assert.doesNotMatch(withReviewPrompt('本次要求', false), /ORIGINAL_MEDIA_PROMPT/)
    assert.equal(withReviewPrompt(withReviewPrompt('本次要求')).split('ORIGINAL_MEDIA_PROMPT').length, 2)
  })
})

for (const source of ['review', 'instruction', 'saved']) {
  test(`overlong human ${source} is rejected before saving or merging model feedback`, async t => {
    const e = await setupModel(t)
    const project = await e.read()
    const text = '改'.repeat(2001)
    const operation = { action: 'shot-seconds', ...{ track: 'S01', generationMode: 'modify' } }
    if (source === 'saved') project.shots.items[0].seconds.review.text = text
    else if (source === 'instruction') Object.assign(operation, { action: 'revise-image', ...{ itemId: 'C01', instruction: text } })
    else operation.review = text
    const store = { save() { assert.fail('must reject before modifying nodes') } }
    await assert.rejects(prepareChecks(store, project, operation), { message: '审核意见过长', status: 400 })
  })
}

test('2000 character human opinion remains valid alongside long model feedback', async t => {
  const e = await setupModel(t)
  const project = await e.read()
  const human = '改'.repeat(2000), model = '模型问题'.repeat(600)
  project.shots.check = { passed: false, failures: [model] }
  const result = await prepareChecks({ save: async (id, patch) => patch(project) }, project, { action: 'shots', ...{ generationMode: 'modify', review: human } })
  assert.equal(result.operation.review, `${model}\n${human}`)
})

test('regenerate ignores overlong old opinions and model feedback', async t => {
  const e = await setupModel(t)
  const project = await e.read()
  project.shots.review.text = '旧人工意见'.repeat(600)
  project.shots.check = { passed: false, failures: ['旧模型意见'.repeat(600)] }
  const result = await prepareChecks({ save: async (id, patch) => patch(project) }, project, { action: 'shots', ...{ generationMode: 'regenerate', review: project.shots.review.text } })
  assert.equal(result.operation.review, '')
  assert.equal(result.project.shots.review.text, project.shots.review.text)
})

test('whole-episode seconds retains its existing human opinion validation', async t => {
  const e = await setupModel(t)
  const project = await e.read(), review = '整集意见'.repeat(600)
  await assert.rejects(prepareChecks({ save: async (id, patch) => patch(project) }, project, { action: 'seconds', generationMode: 'modify', review }), { message: '修改意见不能超过 2000 字', status: 400 })
})

test('overlong human input does not clear existing downstream shots', async t => {
  const e = await setupModel(t), before = await e.read()
  await assert.rejects(runOperation(e.op('shot-table', { generationMode: 'modify', review: '改'.repeat(2001) }), {
    home: e.home, generateShots: () => assert.fail('must not generate'),
  }), { message: '审核意见过长', status: 400 })
  const after = await e.read()
  assert.deepEqual(after.shots.items, before.shots.items)
  assert.deepEqual(after.shots.review, before.shots.review)
})
