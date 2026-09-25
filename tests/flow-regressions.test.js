import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasStoryboard, hasFilm } from '../client/flow-rules.js'
import { stepRunLabel } from '../client/flow-view.js'
import { h3PromptFailures } from '../server/generate/film.js'
import { checkContext, prepareChecks, selectCheck } from '../server/data/self-checks.js'
import { projectStore } from '../server/data/projects.js'
import { feedbackOf } from '../client/feedback.js'
import { runOperation } from '../server/flow/actions.js'
import { completeChat } from '../server/generate/gateway.js'
import { languageInstruction } from '../server/data/language.js'

test('episode completion requires every shot exactly once, not only existing storyboards', () => {
  const p = { shots: { items: [{ id: 'S01' }, { id: 'S02' }] }, storyboard: [{ id: 'S01' }], films: { S01: { status: 'ready' } } }
  assert.equal(hasStoryboard(p), false)
  assert.equal(hasFilm(p), false)
  p.storyboard.push({ id: 'S01' })
  assert.equal(hasStoryboard(p), false)
  p.storyboard[1].id = 'S02'
  assert.equal(hasStoryboard(p), true)
  assert.equal(hasFilm(p), false)
  p.films.S02 = { status: 'ready' }
  assert.equal(hasFilm(p), true)
  p.films.S02.status = 'stale'
  assert.equal(hasFilm(p), false)
  p.feedback = { shots: { check: { passed: false, failures: ['missing speaker'] } } }
  assert.equal(stepRunLabel(p, 'shots'), '自检未通过')
})

test('reference format rejects missing sections, unbound subjects and missing pictures', () => {
  const text = 'subject_definitions: <Subject 1> from <Picture 1>.\nsummary: Walk.\nretention_analysis: Preserve.\ndetailed_description: <Subject 1> walks.\noverall_soundscape: Wind.\nnon_diegetic_music: None.'
  assert.deepEqual(h3PromptFailures(text, [{}]), [])
  assert.ok(h3PromptFailures(text.replace('detailed_description: <Subject 1>', 'detailed_description: <Subject 2>'), [{}]).some(s => s.includes('未定义')))
  assert.ok(h3PromptFailures(text, [{}, {}]).some(s => s.includes('编号')))
  assert.ok(h3PromptFailures('integrated_multimodal_description: Walk.\noverall_soundscape: Wind.\nnon_diegetic_music: None.', [{}]).length)
})

test('failed semantic batch check preserves generated content and stops before the next shot', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-regression-'))
  try {
    const store = projectStore(home)
    const p = await store.create({ title: '测试', summary: '剧情' })
    await checkContext.run({}, async () => {
      const { store: checked } = await prepareChecks(store, p, { action: 'seconds' })
      selectCheck(p, { action: 'shot-seconds', track: 'S01' })
      checkContext.getStore().validation = ['画外上级被画成主角']
      await assert.rejects(checked.save(p.id, { shots: { items: [{ id: 'S01', seconds: [{ action: 'generated' }] }] }, activity: 'seconds' }), { code: 'CONTENT_CHECK_FAILED' })
      await checked.save(p.id, { activity: null, activityError: '自检未通过' })
    })
    const saved = await store.read(p.id)
    assert.equal(saved.shots.items[0].seconds[0].action, 'generated')
    assert.deepEqual(feedbackOf(saved, 'seconds:S01').check.failures, ['画外上级被画成主角'])
    await store.save(p.id, { shots: { items: [{ id: 'S01' }, { id: 'S02' }] }, storyboard: [{ id: 'S01' }], films: { S01: { status: 'ready' } } })
    await assert.rejects(runOperation({ action: 'assemble', projectId: p.id }, { home, concatFilms: () => assert.fail('must not assemble') }), /全部镜头成片/)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('JSON mode is explicit and truncated responses fail before parsing or retrying', async () => {
  let calls = 0
  await assert.rejects(completeChat({ baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', prompt: 'JSON', json: true, fetchImpl: async (_url, options) => {
    calls++
    assert.deepEqual(JSON.parse(options.body).response_format, { type: 'json_object' })
    return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{' } }] })
  } }), { code: 'INCOMPLETE_MODEL_OUTPUT' })
  assert.equal(calls, 1)
  assert.match(languageInstruction({ outputLanguage: 'zh-CN' }), /Mandarin Chinese/)
  assert.match(languageInstruction({ outputLanguage: 'en' }), /对白语言：English/)
})

test('character generation runs independent identity coverage review instead of accepting merged bodies', async t => {
  const { generateCharacters } = await import('../server/generate/story.js')
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++
    const payload = JSON.parse(options.body)
    if (calls === 2) {
      const input = JSON.parse(payload.messages[1].content)
      assert.equal(input.stage, 'meiji-characters')
      assert.match(payload.messages[0].content, /意识的姓名不代表身体相同/)
      return Response.json({ choices: [{ message: { content: JSON.stringify({ passed: false, failures: ['缺少新身体的独立角色卡'] }) } }] })
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ name: '旅人', identity: '意识进入另一具身体', appearance: '原身体和新身体混合', look: '国籍：中国\n姓名：旅人\n身份：旅人\n性别：男\n年代：现代\n年龄：30岁\n服装：灰色外套\n身高：180cm\n体型：高大\n面相：方脸短发' }] }) } }] })
  })
  await checkContext.run({}, async () => {
    const result = await generateCharacters({ route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' }, project: { durationSeconds: 10, outline: '旅人进入另一具身体', outputLanguage: 'zh-CN' } })
    assert.equal(result.items.length, 1)
    assert.deepEqual(checkContext.getStore().validation, ['缺少新身体的独立角色卡'])
  })
  assert.equal(calls, 2)
})

test('independent review does not receive stale correction text as a new instruction', async () => {
  const { askSkill } = await import('../server/generate/chat.js')
  await checkContext.run({ review: 'STALE_ALREADY_FIXED' }, async () => {
    await askSkill('meiji-content-review', JSON.stringify({ stage: 'meiji-characters', generated: { items: [] } }), {
      project: { outputLanguage: 'zh-CN' }, includeReview: false,
      route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' },
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body)
        assert.doesNotMatch(payload.messages[1].content, /STALE_ALREADY_FIXED/)
        assert.equal(JSON.parse(payload.messages[1].content).stage, 'meiji-characters')
        return Response.json({ choices: [{ message: { content: '{"passed":true,"failures":[]}' } }] })
      },
    })
  })
})
