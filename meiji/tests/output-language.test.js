import { episodeFixture } from './fixtures/model.js'
import { outlineFixture } from './fixtures/story-package.js'
import { reviewPass } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { outputLanguage } from '../shared/output-language.js'
import { buildGenerationPrompt } from '../server/prompts/text-prompts.js'
import { materialize } from '../shared/episode-rules.js'
import { generateEpisode } from '../server/flow/tasks/text/task-summary.js'
import { normalizeScenes } from '../shared/story-content.js'

test('language defaults to Chinese, validates values and follows episode context', () => {
  assert.equal(outputLanguage(), 'zh-CN')
  assert.match(buildGenerationPrompt({ skill: 'shots', project: { outputLanguage: 'zh-CN' }, instructions: '' }).user, /Mandarin Chinese/)
  assert.match(buildGenerationPrompt({ skill: 'shots', project: { ...episodeFixture(), outputLanguage: 'en' }, instructions: '' }).user, /对白语言：English/)
  assert.throws(() => outputLanguage('unknown'), /仅支持/)
  assert.match(buildGenerationPrompt({ skill: 'episode', project: { ...episodeFixture(), outputLanguage: 'en' }, instructions: '' }).user, /输出语言：English/)
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
    project: { ...episodeFixture(), durationSeconds: 60, outputLanguage: 'en', plot: { ...episodeFixture().plot, outline: { content: outlineFixture('旅人进入山洞') } } },
  })
  assert.match(payload.messages.find(item => item.role === 'user').content, /输出语言：English/)
  assert.doesNotMatch(payload.messages.find(item => item.role === 'system').content, /读取项目 outputLanguage/)
  assert.match(payload.messages.find(item => item.role === 'user').content, /旅人进入山洞/)
  assert.equal(draft.summary, 'A traveler enters a mysterious cave.')
})

test('English and Chinese character labels and continuity pass equivalent checks', async () => {
  const { normalizeCharacters } = await import('../shared/story-content.js')
  const { videoRequestMode } = await import('../shared/video-rules.js')
  const { tabOf } = await import('../client/flow-view.js')
  const person = normalizeCharacters({ items: [{ name: 'Mike', appearance: 'Tall man with short dark hair', identity: 'Scar on left cheek', look: 'Nationality: Chinese\nName: Mike\nRole: Explorer\nGender: Male\nEra: Modern\nAge: 30 years\nCostume: Grey jacket\nHeight: 178 cm\nBuild: Lean\nFeatures: Square face and short dark hair' }] }).items[0]
  assert.equal(person.role, 'Explorer')
  assert.equal(person.features, 'Square face and short dark hair')
  for (const continuity of ['接着做，同一画面', 'Continue the action in the same frame']) {
    assert.equal(videoRequestMode({ continuity, hasOpening: true, imageCount: 1 }), 'first_frame')
  }
  assert.equal(tabOf({ summary: { content: 'English summary', check: { passed: true } }, plot: {} }), 'script')
})

test('resolved language is stated directly without asking the model to read configuration', async () => {
  const { buildStoryPrompts } = await import('../server/prompts/story-prompts.js')
  const { episodeFixture } = await import('./fixtures/model.js')
  const { checkContext } = await import('../server/runtime/operation-context.js')
  for (const [configured, expected] of [[undefined, '简体中文'], ['zh-CN', '简体中文'], ['en', 'English']]) {
    checkContext.run({ generationMode: 'generate' }, () => {
      const project = { ...episodeFixture(), outputLanguage: configured, projectSummary: '中文资料 Mixed input' }
      const prompts = buildStoryPrompts(project)
      const messages = [prompts.generation, prompts.review('最新大纲'), prompts.revision('失败稿', '修正意见')]
      for (const message of messages) {
        assert.match(message.user, new RegExp(`输出语言：${expected}`))
        assert.doesNotMatch(message.system, /读取项目 outputLanguage|自然语言内容使用项目 outputLanguage|未配置默认 zh-CN|不根据输入材料的语言推断/)
        assert.match(message.system, /既定对白、歌词和画面文字保留原文/)
      }
    })
  }
})
