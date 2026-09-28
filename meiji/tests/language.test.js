import test from 'node:test'
import assert from 'node:assert/strict'
import { outputLanguage, languageInstruction } from '../server/data/language.js'
import { materialize } from '../server/data/episodes.js'
import { generateEpisode, normalizeScenes } from '../server/generate/story.js'

test('language defaults to Chinese, validates values and follows episode context', () => {
  assert.equal(outputLanguage(), 'zh-CN')
  assert.throws(() => outputLanguage('unknown'), /仅支持/)
  assert.match(languageInstruction({ outputLanguage: 'en' }), /English/)
  assert.equal(materialize({ id: 'p', summary: { content: '' }, outputLanguage: 'en', episodes: [{ id: 'e' }] }, 'e').outputLanguage, 'en')
  assert.equal(normalizeScenes({ items: [{ name: 'Cave', landmark: 'Stone arch', light: 'Moonlight', space: 'Narrow tunnel', look: 'An empty ancient cave with a stone arch and scattered rocks.' }] }).items[0].name, 'Cave')
})

test('Chinese input sends English language skill to the model and preserves returned text', async t => {
  let payload
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    payload = JSON.parse(options.body)
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'A traveler enters a mysterious cave.', durationSeconds: 60 }) } }] })
  })
  const draft = await generateEpisode({
    route: { baseUrl: 'http://model.test/v1', apiKey: 'test', model: 'test' },
    project: { title: '沙漠', summary: { content: '旅人进入山洞' }, outputLanguage: 'en', episodes: [] },
  })
  assert.match(payload.messages.find(item => item.role === 'system').content, /本次生成语言：English/)
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
