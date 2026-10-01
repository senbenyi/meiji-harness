import { reviewPass } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { outputLanguage } from '../server/data/language.js'
import { buildGenerationPrompt } from '../server/prompts/text-prompts.js'
import { materialize } from '../server/data/episodes.js'
import { generateEpisode, normalizeScenes } from '../server/generate/story.js'

test('language defaults to Chinese, validates values and follows episode context', () => {
  assert.equal(outputLanguage(), 'zh-CN')
  assert.match(buildGenerationPrompt({ skill: 'shots', project: { outputLanguage: 'zh-CN' }, instructions: '' }).system, /Mandarin Chinese/)
  assert.match(buildGenerationPrompt({ skill: 'shots', project: { outputLanguage: 'en' }, instructions: '' }).system, /对白语言：English/)
  assert.throws(() => outputLanguage('unknown'), /仅支持/)
  assert.match(buildGenerationPrompt({ skill: 'episode', project: { outputLanguage: 'en' }, instructions: '' }).user, /本次生成语言：English/)
  assert.equal(materialize({ id: 'p', summary: { content: '' }, outputLanguage: 'en', episodes: [{ id: 'e' }] }, 'e').outputLanguage, 'en')
  assert.equal(normalizeScenes({ items: [{ name: 'Cave', landmark: 'Stone arch', light: 'Moonlight', space: 'Narrow tunnel', look: 'An empty ancient cave with a stone arch and scattered rocks.' }] }).items[0].name, 'Cave')
})

test('Chinese input sends English language skill to the model and preserves returned text', async t => {
  let payload, calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    // 第一次为生成请求，其后为自审（须返回 PASS）。
    if (++calls > 1) return Response.json({ choices: [{ message: { content: reviewPass } }] })
    payload = JSON.parse(options.body)
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'A traveler enters a mysterious cave.', durationSeconds: 60 }) } }] })
  })
  const draft = await generateEpisode({ referenceDurationSeconds: 60,
    route: { baseUrl: 'http://model.test/v1', apiKey: 'test', model: 'test' },
    project: { title: '沙漠', summary: { content: '旅人进入山洞' }, outputLanguage: 'en', episodes: [] },
  })
  assert.match(payload.messages.find(item => item.role === 'user').content, /本次生成语言：English/)
  assert.match(payload.messages.find(item => item.role === 'user').content, /旅人进入山洞/)
  assert.equal(draft.summary, 'A traveler enters a mysterious cave.')
})

test('English and Chinese character labels and continuity pass equivalent checks', async () => {
  const { normalizeCharacters } = await import('../server/generate/story.js')
  const { videoRequestMode } = await import('../server/generate/film.js')
  const { tabOf } = await import('../client/flow-view.js')
  const person = normalizeCharacters({ items: [{ name: 'Mike', appearance: 'Tall man with short dark hair', identity: 'Scar on left cheek', look: 'Nationality: Chinese\nName: Mike\nRole: Explorer\nGender: Male\nEra: Modern\nAge: 30 years\nCostume: Grey jacket\nHeight: 178 cm\nBuild: Lean\nFeatures: Square face and short dark hair' }] }).items[0]
  assert.equal(person.role, 'Explorer')
  assert.equal(person.features, 'Square face and short dark hair')
  for (const continuity of ['接着做，同一画面', 'Continue the action in the same frame']) {
    assert.equal(videoRequestMode({ continuity, hasOpening: true, imageCount: 1 }), 'first_frame')
  }
  assert.equal(tabOf({ summary: { content: 'English summary' }, plot: {} }), 'script')
})

test('resolved language is stated directly without asking the model to read configuration', async () => {
  const { buildStoryPrompts } = await import('../server/prompts/story-prompts.js')
  const { episodeFixture } = await import('./fixtures/model.js')
  const { checkContext } = await import('../server/data/operation-context.js')
  for (const [configured, expected] of [[undefined, '简体中文'], ['zh-CN', '简体中文'], ['en', 'English']]) {
    checkContext.run({ generationMode: 'generate' }, () => {
      const project = { ...episodeFixture(), outputLanguage: configured, projectSummary: '中文资料 Mixed input' }
      const prompts = buildStoryPrompts(project)
      const messages = [prompts.generation, prompts.review('最新大纲'), prompts.revision('失败稿', '修正意见')]
      for (const message of messages) {
        assert.match(message.system, new RegExp(`本次生成语言：${expected}`))
        assert.match(message.system, /使用此语言生成自然语言内容/)
        assert.doesNotMatch(message.system, /读取项目 outputLanguage|自然语言内容使用项目 outputLanguage|未配置默认 zh-CN|不根据输入材料的语言推断/)
        assert.match(message.system, /既定对白、歌词和画面文字保留原文/)
      }
    })
  }
})
