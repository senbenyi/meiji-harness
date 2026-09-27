import test from 'node:test'
import assert from 'node:assert/strict'
import { episodePrompt, normalizeEpisodeDraft } from '../server/generate/story.js'
import { describeOperation } from '../server/flow/actions.js'

test('the first episode is written from the project summary and stays within three minutes', () => {
  const prompt = episodePrompt({ title: '桃源', summary: { content: '李伟穿越' }, episodes: [], aspectRatio: '768x1344', style: '写实电影' })
  assert.match(prompt, /第 1 集只根据项目摘要/)
  assert.match(prompt, /李伟穿越/)
  assert.match(prompt, /视觉风格：写实电影/)
  assert.equal(/承接上一集/.test(prompt), false)
  assert.deepEqual(normalizeEpisodeDraft({ summary: '开场结义', durationSeconds: 180 }), { summary: '开场结义', durationSeconds: 180 })
  assert.throws(() => normalizeEpisodeDraft({ summary: '太长', durationSeconds: 181 }), { status: 502 })
})

test('a later episode continues from the episodes already shot', () => {
  const prompt = episodePrompt({
    title: '桃源',
    summary: { content: '李伟穿越' },
    episodes: [
      { summary: { content: '第二集回头' }, durationSeconds: 90 },
      { summary: { content: '第一集结义' }, durationSeconds: 120 },
    ],
  })
  assert.match(prompt, /第 3 集/)
  assert.match(prompt, /第 1 集（120 秒）：第一集结义/)
  assert.match(prompt, /第 2 集（90 秒）：第二集回头/)
  const text = describeOperation({ action: 'episode-generate' })
  assert.match(text, /meiji_episode/)
  assert.match(text, /skill-gailan-episode-generate\.md/)
  assert.match(text, /函数：generateEpisode/)
  assert.equal(/meiji_panel/.test(text), false)
})

test('regeneration targets the selected episode and separates later continuity constraints', () => {
  const project = { title: '故事', summary: { content: '总摘要' }, script: '项目剧本', episodes: [
    { id: 'c', summary: { content: '结尾' }, durationSeconds: 60 },
    { id: 'b', summary: { content: '旧中段' }, durationSeconds: 90 },
    { id: 'a', summary: { content: '开场' }, durationSeconds: 120 },
  ] }
  const prompt = episodePrompt(project, 'b')
  assert.match(prompt, /这一集是第 2 集/)
  assert.match(prompt, /第 1 集（120 秒）：开场/)
  assert.match(prompt, /后续剧集是衔接约束/)
  assert.match(prompt, /第 3 集：结尾/)
  assert.match(prompt, /项目剧本/)
  assert.throws(() => episodePrompt(project, 'missing'), { status: 404 })
})
