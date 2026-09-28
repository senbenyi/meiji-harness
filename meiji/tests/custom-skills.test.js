import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { customSkillPatch, skillSupplement } from '../server/data/custom-skills.js'
import { projectStore } from '../server/data/projects.js'
import { addEpisode, scopeProjects } from '../server/data/episodes.js'
import { episodeWork } from '../client/overview.js'
import { buildGenerationPrompt } from '../server/prompts/text-prompts.js'
import { runTextRequest } from '../server/generate/text-request.js'
import { previewFilmSubmit } from '../server/flow/actions.js'

test('supplements persist per episode and stage, and clear without changing generated content', async () => {
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
    await scoped.save(p.id, current => customSkillPatch(current, 'shots', 'Keep scale'))
    await scoped.save(p.id, current => customSkillPatch(current, 'outline', 'Slow pace'))
    const reloaded = await scopeProjects(projectStore(home), id).read(p.id)
    assert.deepEqual(reloaded.customSkills, { shots: 'Keep scale', outline: 'Slow pace' })
    assert.equal(episodeWork(await store.read(p.id), id).customSkills.shots, 'Keep scale')
    assert.deepEqual((await scopeProjects(store, other).read(p.id)).customSkills, {})
    assert.match(skillSupplement(reloaded, 'skill-jingtou-jingtoubiao-shot-review'), /Keep scale/)
    assert.equal(skillSupplement(reloaded, 'skill-jingtou-wenben-storyboard-generate'), '')
    await scoped.save(p.id, current => customSkillPatch(current, 'shots', ''))
    const cleared = await scoped.read(p.id)
    assert.equal(cleared.customSkills.shots, undefined)
    assert.equal(cleared.customSkills.outline, 'Slow pace')
    assert.equal(cleared.plot.outline.content, 'existing')
    assert.throws(() => customSkillPatch({}, 'bad', 'x'))
    assert.throws(() => customSkillPatch({}, 'shots', 'x'.repeat(20001)))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('text model receives the base skill and only the current stage supplement', async () => {
  await runTextRequest(buildGenerationPrompt({ skill: 'skill-jingtou-meimiao-seconds-generate', instructions: 'Generate', project: { outputLanguage: 'en', customSkills: { seconds: 'Keep slow motion', shots: 'OTHER STAGE' } } }), {
    project: { outputLanguage: 'en', customSkills: { seconds: 'Keep slow motion', shots: 'OTHER STAGE' } },
    route: { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' },
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body)
      assert.match(payload.messages[0].content, /Per-Second Directives/)
      assert.match(payload.messages[0].content, /English/)
      assert.match(payload.messages[1].content, /Keep slow motion/)
      assert.doesNotMatch(payload.messages[1].content, /OTHER STAGE/)
      return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })
    },
  })
})

test('video payload includes film supplement literally and preserves H3 sections', () => {
  const board = { id: 'S01', video: 'text', duration: 5, prompt: { text: 'integrated_multimodal_description: Walk.\noverall_soundscape: Wind.\nnon_diegetic_music: None.' } }
  const result = previewFilmSubmit({ shots: { items: [{ id: 'S01' }] }, customSkills: { film: 'Hold $& details', storyboard: 'DO NOT INCLUDE' } }, board)
  assert.ok(result.prompt.includes('Hold $& details'))
  assert.doesNotMatch(result.prompt, /DO NOT INCLUDE/)
  assert.match(result.prompt, /overall_soundscape: Wind/)
})
