import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { generateShotStoryboard } from '../server/generate/shot-text.js'
import { reviewContent } from '../server/generate/review.js'
import { continuityReviewContext } from '../server/prompts/continuity-review.js'

test('generation and independent review: only review receives previous final prompt and exact material map', async () => {
  const p = episodeFixture()
  p.shots.items[0].storyboard.content.prompt.text = '前镜结束：旅人面北站在北墙，右手持灯。'
  p.shots.items[0].storyboard.content.referenceSnapshot = [{ name: '旅人', url: 'https://test/previous-person' }]
  const calls = []
  await generateShotStoryboard({ project: p, shotId: 'S02', request: async ({ skill, user: prompt }) => {
    calls.push(prompt)
    return skill === 'review' ? 'PASS' : '[opening-reference: none]\n旅人继续面北。'
  } })
  assert.equal(calls.length, 2)
  assert.doesNotMatch(calls[0], /前镜结束：旅人面北站在北墙/)
  assert.match(calls[1], /前镜结束：旅人面北站在北墙/)
  assert.match(calls[1], /https:\/\/test\/previous-person/)
  assert.match(calls[1], /旅人继续面北/)
})

test('manual edit review includes previous final prompt and current timeline', async () => {
  const p = episodeFixture()
  p.shots.items[0].storyboard.content.prompt.text = '前镜最终正文'
  let prompt
  await reviewContent({ project: p, shotId: 'S02', stage: 'storyboard', text: '修改后的正文', request: async ({ user: text }) => { prompt = text; return 'PASS' } })
  assert.match(prompt, /前镜最终正文/)
  assert.match(prompt, /修改后的正文/)
  assert.match(prompt, /当前镜头 S02 每秒指令/)
})

test('first shot and unavailable previous shots do not invent continuity evidence', () => {
  const p = episodeFixture()
  assert.match(continuityReviewContext(p, 'S01'), /本镜为第一镜/)
  p.shots.items[0].storyboard.content.prompt.text = '不可用的前镜'
  for (const state of ['failed', 'stale', 'missing']) {
    p.shots.items[0].storyboard.check.passed = state !== 'failed'
    p.shots.items[0].storyboard.stale = state === 'stale'
    if (state === 'missing') p.shots.items[0].storyboard.content = null
    const text = continuityReviewContext(p, 'S02')
    assert.doesNotMatch(text, /不可用的前镜/)
    assert.match(text, /不得声称/)
  }
})
