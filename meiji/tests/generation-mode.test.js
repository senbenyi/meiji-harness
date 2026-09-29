import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from '../server/flow/operations/run.js'
import { generateShotSeconds } from '../server/generate/shot-text.js'
import { prepareChecks, withReviewPrompt } from '../server/data/review-checks.js'
import { checkContext } from '../server/data/operation-context.js'

for (const generationMode of ['regenerate', 'modify']) {
  test(`${generationMode} isolates old output and opinions while reviewing newest output`, async t => {
    const e = await setupModel(t), models = modelStore(e.home)
    await models.write({ ...await models.read(), apiKey: 'test-only' })
    await e.store.save(e.id, p => {
      const node = p.episodes[0].shots.items[0].seconds
      node.content = 'OLD_OUTPUT_MARKER'; node.review.text = 'OLD_HUMAN_MARKER'
      node.check = { passed: false, failures: ['OLD_CHECK_MARKER'] }
      return p
    })
    const calls = []
    await runOperation(e.op('shot-seconds', { track: 'S01', generationMode }), { home: e.home,
      generateShotSeconds: options => generateShotSeconds({ ...options, request: async ({ skill, user: prompt }) => {
        calls.push({ skill, prompt }); return skill === 'skill-gongyong-content-review' ? 'PASS' : 'NEW_OUTPUT_MARKER'
      } }),
    })
    const generation = calls[0].prompt
    for (const marker of ['OLD_OUTPUT_MARKER', 'OLD_HUMAN_MARKER', 'OLD_CHECK_MARKER']) assert.equal(generation.includes(marker), generationMode === 'modify', marker)
    assert.match(calls[1].prompt, /【本次待审内容】\nNEW_OUTPUT_MARKER/)
    assert.doesNotMatch(calls[1].prompt, /OLD_OUTPUT_MARKER/)
    const node = (await e.read()).shots.items[0].seconds
    assert.equal(node.content, 'NEW_OUTPUT_MARKER')
    assert.equal(node.review.text, generationMode === 'regenerate' ? 'OLD_HUMAN_MARKER' : '')
  })
}

test('modify rejects missing original or missing opinion before saving', async t => {
  const e = await setupModel(t)
  const project = await e.read()
  const store = { save() { assert.fail('invalid modification must not save') } }
  await assert.rejects(prepareChecks(store, project, { action: 'shot-seconds', track: 'S01', generationMode: 'modify' }), /修改需要/)
  project.shots.items[0].seconds.content = null
  await assert.rejects(prepareChecks(store, project, { action: 'shot-seconds', track: 'S01', generationMode: 'modify', review: '修改方向' }), /修改需要/)
})

test('media modifications carry original submitted prompt; reviews exclude it', () => {
  checkContext.run({ review: '修改光线', originalCandidate: { prompt: 'ORIGINAL_MEDIA_PROMPT' } }, () => {
    assert.match(withReviewPrompt('本次要求'), /ORIGINAL_MEDIA_PROMPT/)
    assert.doesNotMatch(withReviewPrompt('本次要求', false), /ORIGINAL_MEDIA_PROMPT/)
    assert.equal(withReviewPrompt(withReviewPrompt('本次要求')).split('ORIGINAL_MEDIA_PROMPT').length, 2)
  })
})
