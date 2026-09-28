import { episodeFixture, setupModel } from './fixtures/model.js'
import { setContent } from '../client/drama-model.js'
import { generateAllSeconds } from '../server/generate/shot-text.js'
import { storyPackageFixture } from './fixtures/story-package.js'
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
  const p = episodeFixture()
  const story = p.shots.items[1].storyboard.content
  p.shots.items[1].storyboard.content = null
  assert.equal(hasStoryboard(p), false)
  p.shots.items[1].storyboard.content = story
  assert.equal(hasStoryboard(p), true)
  assert.equal(hasFilm(p), false)
  for (const shot of p.shots.items) setContent(shot.video, { status: 'ready' }, { passed: true, failures: [] })
  assert.equal(hasFilm(p), true)
  p.shots.items[1].video.status = 'failed'
  assert.equal(hasFilm(p), false)
  p.shots.status = 'failed'
  assert.equal(stepRunLabel(p, 'shots'), '未通过')
})

test('reference format rejects missing sections, unbound subjects and missing pictures', () => {
  const text = 'subject_definitions: <Subject 1> from <Picture 1>.\nsummary: Walk.\nretention_analysis: Preserve.\ndetailed_description: <Subject 1> walks.\noverall_soundscape: Wind.\nnon_diegetic_music: None.'
  assert.deepEqual(h3PromptFailures(text, [{}]), [])
  assert.ok(h3PromptFailures(text.replace('detailed_description: <Subject 1>', 'detailed_description: <Subject 2>'), [{}]).some(s => s.includes('未定义')))
  assert.ok(h3PromptFailures(text, [{}, {}]).some(s => s.includes('编号')))
  assert.ok(h3PromptFailures('integrated_multimodal_description: Walk.\noverall_soundscape: Wind.\nnon_diegetic_music: None.', [{}]).length)
})

test('failed semantic batch checks preserve each latest result and audit all shots', async t => {
  const e = await setupModel(t);await e.store.save(e.id,p=>{p.episodes[0].shots.items.forEach(s=>{s.seconds.stale=true});return p});
  const {modelStore}=await import('../server/data/models.js');const models=modelStore(e.home);await models.write({...await models.read(),apiKey:'test-only'})
  let calls = 0
  await assert.rejects(runOperation(e.op('seconds'), { home: e.home, generateAllSeconds: opts => generateAllSeconds({ ...opts, request: async ({ skill }) => { calls++; return skill === 'skill-gongyong-content-review' ? 'FAIL 画外上级被画成主角' : calls === 1 ? '## S01 / 5s\n已生成的动作\n## S02 / 5s\n已生成的动作\n[seconds-complete]' : '已生成的动作' } }) }), /自检未通过/)
  const p = await e.read()
  assert.equal(calls, 7)
  assert.equal(p.shots.items[0].seconds.content, '已生成的动作')
  assert.equal(p.shots.items[0].seconds.status, 'failed')
  assert.equal(p.shots.items[0].seconds.check.history.length, 2)
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
  const { generateStoryPackage } = await import('../server/generate/story.js')
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++
    const payload = JSON.parse(options.body)
    if (calls % 2 === 0) {
      assert.match(payload.messages[1].content, /skill-juqing-outline-generate/)
      assert.match(payload.messages[0].content, /意识的姓名不代表身体相同/)
      return Response.json({ choices: [{ message: { content: 'FAIL\n缺少新身体的独立角色卡' } }] })
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(storyPackageFixture(10)) } }] })
  })
  await checkContext.run({}, async () => {
    const result = await generateStoryPackage({ route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' }, project: { ...episodeFixture(), outputLanguage: 'zh-CN' } })
    assert.equal(result.characters.items.length, 1)
    assert.deepEqual(checkContext.getStore().validation, ['FAIL\n缺少新身体的独立角色卡'])
  })
  assert.equal(calls, 4)
})

test('independent review does not receive stale correction text as a new instruction', async () => {
  const { buildReviewPrompt } = await import('../server/prompts/text-prompts.js')
  const { runTextRequest } = await import('../server/workers/text-request-worker.js')
  await checkContext.run({ review: 'STALE_ALREADY_FIXED' }, async () => {
    await runTextRequest(buildReviewPrompt({ skill: 'skill-juqing-outline-generate', project: {}, instructions: '本次任务' }, JSON.stringify({ outline: '', characters: { items: [] }, scenes: { items: [] } })), {
      route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' },
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body)
        assert.doesNotMatch(payload.messages[1].content, /STALE_ALREADY_FIXED/)
        assert.match(payload.messages[1].content, /阶段：skill-juqing-outline-generate/)
        return Response.json({ choices: [{ message: { content: 'PASS' } }] })
      },
    })
  })
})

test('changing shot references keeps downstream invalidation instead of restoring old renders', async t => {
  const e = await setupModel(t)
  setContent(e.episode.shots.items[0].video, { status: 'ready', url: 'https://test/video' }, { passed: true, failures: [] })
  setContent(e.episode.shots.items[0].pencil, { imageUrl: 'https://test/pencil' }, { passed: true, failures: [] })
  await e.store.save(e.id, { episodes: [e.episode] })
  await runOperation({ ...e.op('shot-assets'), track: 'S01', characterIds: ['C01'], sceneId: 'E01' }, { home: e.home })
  const p = await e.read()
  assert.equal(p.shots.items[0].storyboard.stale, true)
  assert.equal(p.shots.items[0].storyboard.check.passed, null)
  assert.equal(p.shots.items[0].video.content, null)
  assert.equal(p.shots.items[0].pencil.content, null)
  assert.equal(p.assembly.content, null)
})
