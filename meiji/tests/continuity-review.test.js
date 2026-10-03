import { reviewPass } from './fixtures/review-result.js'
import { storyboardFixture } from './fixtures/storyboard.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { generateShotStoryboard } from '../server/flow/tasks/text/task-storyboard-prompt.js'
import { reviewContent } from '../server/runtime/text-generation.js'
import { continuityReviewContext } from '../server/prompts/continuity-review.js'

test('binding generation and review keep the current timeline and exclude previous final prompts', async () => {
  const p = episodeFixture()
  p.shots.items[0].storyboard.content.prompt.text = '前镜结束：旅人面北站在北墙，右手持灯。'
  p.shots.items[0].storyboard.content.referenceSnapshot = [{ name: '旅人', url: 'https://test/previous-person' }]
  const calls = []
  const rows = await generateShotStoryboard({ project: p, shotId: 'S02', request: async ({ skill, user: prompt }) => {
    calls.push(prompt)
    return skill === 'review' ? reviewPass : storyboardFixture(prompt)
  } })
  assert.equal(calls.length, 0)
  assert.doesNotMatch(rows[1].prompt.text, /前镜结束|previous-person/)
  assert.match(rows[1].prompt.text, /旅人朝北/)
})

test('manual edit review only receives the current timeline, selected references and edited prompt', async () => {
  const p = episodeFixture()
  p.shots.items[0].storyboard.content.prompt.text = '前镜最终正文'
  let prompt
  await reviewContent({ project: p, shotId: 'S02', stage: 'storyboard', text: '修改后的正文', request: async ({ user: text }) => { prompt = text; return reviewPass } })
  assert.doesNotMatch(prompt, /前镜最终正文|本集摘要|大纲|完整镜头表/)
  assert.match(prompt, /修改后的正文/)
  assert.match(prompt, /本镜已通过每秒指令/)
  assert.match(prompt, /镜头：S02/)
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
