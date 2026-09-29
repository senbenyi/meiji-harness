import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { additionsPatch, guidancePatch, projectSkills } from '../server/data/skill-store.js'
import { projectStore } from '../server/data/projects.js'
import { addEpisode, scopeProjects } from '../server/data/episodes.js'
import { episodeWork } from '../client/overview.js'
import { buildGenerationPrompt, buildTextPrompts } from '../server/prompts/text-prompts.js'
import { runTextRequest } from '../server/generate/text-request.js'
import { previewFilmSubmit } from '../server/flow/operations/run.js'

test('本剧补充 is saved once per project, shared by every episode, and clears without touching content', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-custom-'))
  try {
    const store = projectStore(home)
    const p = await store.create({ title: 'Test', summary: 'Story' })
    let saved = await store.save(p.id, current => addEpisode(current, { summary: 'One', durationSeconds: 10 }))
    const id = saved.episodes[0].id
    saved = await store.save(p.id, current => addEpisode(current, { summary: 'Two', durationSeconds: 10 }))
    const other = saved.episodes[0].id
    const scoped = scopeProjects(store, id)
    await scoped.save(p.id, current => { current.plot.outline.content = 'existing'; return { plot: current.plot } })
    await store.save(p.id, current => ({ skills: additionsPatch(current.skills, 'shots', { generate: 'Keep scale', review: 'Check scale' }) }))
    await store.save(p.id, current => ({ skills: additionsPatch(current.skills, 'outline', { generate: 'Slow pace' }) }))
    const reloaded = await scopeProjects(projectStore(home), id).read(p.id)
    assert.deepEqual(reloaded.skills.additions, { shots: { generate: 'Keep scale', review: 'Check scale' }, outline: { generate: 'Slow pace' } })
    assert.deepEqual((await scopeProjects(store, other).read(p.id)).skills.additions.shots, { generate: 'Keep scale', review: 'Check scale' })
    assert.equal(episodeWork(await store.read(p.id), id).skills.additions.outline.generate, 'Slow pace')
    for (const episode of (await store.read(p.id)).episodes) assert.equal('customSkills' in episode || 'guidanceAssets' in episode, false)
    const prompts = buildTextPrompts({ skill: 'shots', project: reloaded, instructions: 'CTX' })
    assert.match(prompts.generation.system, /【本剧补充·生成】\nKeep scale/)
    assert.match(prompts.generation.system, /【本剧补充·审核】\nCheck scale/)
    assert.match(prompts.review('DRAFT').user, /【本剧补充·生成】\nKeep scale[\s\S]*【本剧补充·审核】\nCheck scale/)
    assert.doesNotMatch(buildGenerationPrompt({ skill: 'storyboard', project: reloaded, instructions: 'CTX' }).system, /Keep scale|Slow pace/)
    await store.save(p.id, current => ({ skills: additionsPatch(current.skills, 'shots', { generate: '', review: '' }) }))
    const cleared = await scoped.read(p.id)
    assert.equal(cleared.skills.additions.shots, undefined)
    assert.equal(cleared.skills.additions.outline.generate, 'Slow pace')
    assert.equal(cleared.plot.outline.content, 'existing')
    assert.throws(() => additionsPatch({}, 'bad', { generate: 'x' }), /技能不存在/)
    assert.throws(() => additionsPatch({}, 'shots', { protocol: 'x' }), /不可补充/)
    assert.throws(() => additionsPatch({}, 'shared-language', { text: 'x' }), /共享模块/)
    assert.throws(() => additionsPatch({}, 'shots', { generate: 'x'.repeat(20001) }), /20000/)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('guidance defaults enable action, dialogue, expression and sound; martial is opt-in per drama', () => {
  assert.deepEqual(projectSkills(undefined).guidance.enabled, ['action', 'dialogue', 'expression', 'sound'])
  assert.deepEqual(guidancePatch(undefined, ['sound', 'martial']).guidance.enabled, ['martial', 'sound'])
  assert.throws(() => guidancePatch(undefined, ['unknown']), /指导技能无效/)
})

test('text model receives the base skill and only the current stage supplement', async () => {
  const project = { outputLanguage: 'en', skills: { additions: { seconds: { generate: 'Keep slow motion' }, shots: { generate: 'OTHER STAGE' } } } }
  await runTextRequest(buildGenerationPrompt({ skill: 'seconds', instructions: 'Generate', project }), {
    project, route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' },
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body)
      assert.match(payload.messages[0].content, /人物朝向与可见面/)
      assert.match(payload.messages[0].content, /English/)
      assert.match(payload.messages[0].content, /Keep slow motion/)
      assert.doesNotMatch(payload.messages[0].content + payload.messages[1].content, /OTHER STAGE/)
      return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })
    },
  })
})

test('video payload includes the 成片 本剧补充 literally and preserves H3 sections', () => {
  const board = { id: 'S01', video: 'text', duration: 5, prompt: { text: 'integrated_multimodal_description: Walk.\noverall_soundscape: Wind.\nnon_diegetic_music: None.' } }
  const result = previewFilmSubmit({ shots: { items: [{ id: 'S01' }] }, skills: { additions: { video: { generate: 'Hold $& details' }, storyboard: { generate: 'DO NOT INCLUDE' } } } }, board)
  assert.ok(result.prompt.includes('Hold $& details'))
  assert.doesNotMatch(result.prompt, /DO NOT INCLUDE/)
  assert.match(result.prompt, /overall_soundscape: Wind/)
  assert.equal(previewFilmSubmit({ shots: { items: [{ id: 'S01' }] } }, board).prompt.includes('自定义 skill'), false)
})
