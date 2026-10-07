import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectAggregate, parseProject } from '../../lib/domain/spec.js'
import { applyCreativeProposal, editGeneration } from '../../lib/domain/creative.js'
import { assetScriptRefs, assetUsageSegments, deterministicKnownAssetExtraction, extractAssetsByEpisode, materializeAssetUsages, validateAssetExtraction } from '../../lib/script/asset-production.js'
import { mergeShotPrompts, shotPromptRequests } from '../../lib/script/shot-production.js'
import { assertGenerationReady, visibleReferenceBindings } from '../../lib/prompts/specification.js'
import { productionStageIssues, preparationSignature } from '../../lib/domain/policies.js'
import { dramaProductionTasks } from '../../lib/production/drama.js'
import { reworkTasks } from '../../lib/production/rework.js'
import { compilePromptSnapshot } from '../../lib/prompts/compiler.js'
import { generation, extractedAssets } from '../helpers/generation.js'

function fixture() {
  const p = createProjectAggregate({ id: 'creative' })
  p.sourceDocuments.src = { contentHash: 'hash', characters: 100 }
  const sourceRefs = [{ sourceId: 'src', contentHash: 'hash' }]
  p.storyBible = { summary: 'A traveler returns a letter.', proposalId: 'analysis' }
  p.developmentProposals.analysis = { kind: 'content_analysis', status: 'approved', sourceRefs }
  p.developmentProposals.script = { kind: 'episode_script', status: 'approved', sourceRefs }
  p.episodes.ep = { id: 'ep', script: 'The traveler in a raincoat opens a wet letter in the station.', sourceSpans: [{ sourceId: 'src', start: 0, end: 100 }], proposalId: 'script', analysisProposalId: 'analysis', shotIds: ['shot'], status: 'storyboard' }
  const entity = (id, name) => ({ id, name, description: name, usages: [{ episodeId: 'ep', quote: p.episodes.ep.script }], generation: generation() })
  const assets = { characters: [entity('traveler', 'Traveler')], locations: [entity('station', 'Station')], props: [entity('letter', 'Letter')], assetVariants: [{ ...entity('wet-letter', 'Wet letter'), parentKind: 'prop', parentId: 'letter', changes: 'Wet paper', preserve: 'Letter handwriting and size' }], scriptRefs: assetScriptRefs(Object.values(p.episodes)) }
  applyCreativeProposal(p, { id: 'assets', kind: 'asset_extraction', payload: assets })
  p.shots.shot = { id: 'shot', episodeId: 'ep', status: 'planned', proposalId: 'script', analysisProposalId: 'analysis', shotDescription: 'The traveler opens the wet letter.', prompt: 'Planning intent', duration: 5, characterIds: ['traveler'], referenceBindings: [{ kind: 'character', entityId: 'traveler' }, { kind: 'location', entityId: 'station' }, { kind: 'prop', entityId: 'letter' }, { kind: 'variant', entityId: 'wet-letter' }], assetIds: [], attemptIds: [] }
  const images = { shots: [{ id: 'shot', generation: generation() }] }
  const videos = { shots: [{ id: 'shot', generation: generation('video') }] }
  applyCreativeProposal(p, { id: 'prompts', kind: 'shot_prompts', payload: mergeShotPrompts(p, p.episodes.ep, images, videos) })
  return { p, assets, images, videos }
}

test('asset extraction reads one formal episode at a time and merges shared identity usage', async () => {
  const episodes = [{ id: 'ep1', script: 'MORNING_ONLY traveler leaves a letter.' }, { id: 'ep2', script: 'NIGHT_ONLY traveler returns.' }]
  const seen = []
  const assets = await extractAssetsByEpisode(episodes, {}, async ([request]) => {
    const episode = episodes[seen.length]
    assert.ok(request.prompt.includes(episode.script))
    assert.ok(!request.prompt.includes(episodes.find((item) => item !== episode).script))
    assert.equal(request.schema.properties.characters.items.properties.generation, undefined)
    seen.push(request.label)
    const value = extractedAssets([{ id: 'traveler', name: 'Traveler', description: 'Blue coat' }], [{ id: 'station', name: 'Station', description: 'Waiting room' }], episode.id, episode.script)
    request.validate(value)
    return [value]
  })
  assert.deepEqual(seen, ['asset-extraction:ep1', 'asset-extraction:ep2'])
  assert.equal(assets.characters.length, 1)
  assert.deepEqual(assets.characters[0].usages.map((use) => use.episodeId), ['ep1', 'ep2'])
})

test('asset usage citations are materialized from exact formal script text', () => {
  const episodes = [{ id: 'ep', script: 'INT. ROOM\nTraveler opens the letter.\nThe light fades.' }]
  const value = extractedAssets([{ id: 'traveler', name: 'Traveler', description: 'Blue coat' }], [{ id: 'room', name: 'Room', description: 'Small room' }], 'ep', 'invented wording')
  value.characters[0] = { ...value.characters[0], usageRef: 'ep:u002' }
  value.locations[0] = { ...value.locations[0], usageRef: 'ep:u001' }
  delete value.characters[0].usages
  delete value.locations[0].usages
  materializeAssetUsages(value, assetUsageSegments(episodes))
  validateAssetExtraction(value, episodes, false)
  assert.equal(value.characters[0].usages[0].quote, 'Traveler opens the letter.')
  assert.equal(value.locations[0].usages[0].quote, 'INT. ROOM')
})

test('known asset extraction recovers exact name mentions without inventing assets', () => {
  const episodes = [{ id: 'ep', script: 'INT. Station\nTraveler opens the letter.' }]
  const existing = {
    characters: { traveler: { id: 'traveler', name: 'Traveler', description: 'Blue coat' } },
    locations: { station: { id: 'station', name: 'Station', description: 'Waiting room' } },
    props: { letter: { id: 'letter', name: 'Letter', description: 'White envelope' }, unseen: { id: 'unseen', name: 'Watch', description: 'Silver watch' } },
  }
  const value = deterministicKnownAssetExtraction(episodes, existing)
  assert.deepEqual(value.characters.map(({ id, usageRef }) => [id, usageRef]), [['traveler', 'ep:u002']])
  assert.deepEqual(value.locations.map(({ id, usageRef }) => [id, usageRef]), [['station', 'ep:u001']])
  assert.deepEqual(value.props.map(({ id, usageRef }) => [id, usageRef]), [['letter', 'ep:u002']])
})

test('visible references select the authored variant without mixing its base state into the same shot', () => {
  const { p } = fixture()
  for (const binding of p.shots.shot.referenceBindings) {
    binding.assetId = `${binding.entityId}-image`
    p.assets[binding.assetId] = { id: binding.assetId, kind: 'image', status: 'approved', contentHash: binding.entityId }
  }
  const bindings = visibleReferenceBindings(p, p.shots.shot)
  assert.deepEqual(bindings.map((binding) => binding.entityId), ['traveler', 'station', 'wet-letter'])
  const params = { referenceIds: bindings.map((binding) => binding.assetId) }
  const snapshot = compilePromptSnapshot({ project: p, shotId: 'shot', capability: 'image.image2image', target: { kind: 'storyboard', id: 'shot' }, parameters: params })
  assert.deepEqual(snapshot.references.map((ref) => ref.entityId), ['traveler', 'station', 'wet-letter'])
  assert.throws(() => compilePromptSnapshot({ project: p, shotId: 'shot', capability: 'image.image2image', target: { kind: 'storyboard', id: 'shot' }, parameters: { referenceIds: p.shots.shot.referenceBindings.map((binding) => binding.assetId) } }), /按绑定顺序/)
  p.shots.shot.referenceBindings.push({ kind: 'variant', entityId: 'wet-letter' })
  assert.throws(() => visibleReferenceBindings(p, p.shots.shot), /多个视觉状态/)
})

test('script extraction persists props and variants with full prompts and rejects fabricated usage or stale scripts', () => {
  const { p, assets } = fixture()
  assert.equal(p.assetVariants['wet-letter'].parentId, 'letter')
  assert.equal(assertGenerationReady(p, p.props.letter, 'image').status, 'ready')
  const bad = structuredClone(assets)
  bad.props[0].usages[0].quote = 'Text not in the formal script'
  assert.throws(() => applyCreativeProposal(structuredClone(p), { kind: 'asset_extraction', payload: bad }), /不存在的剧本文字/)
  p.episodes.ep.script += ' The traveler leaves.'
  assert.throws(() => applyCreativeProposal(p, { kind: 'asset_extraction', payload: assets }), /过期/)
  assert.throws(() => assertGenerationReady(p, p.props.letter, 'image'), /已过期/)
})

test('independent authored image and video prompts are mandatory; prose and H3 headings cannot replace them', () => {
  const { p } = fixture()
  assert.deepEqual(productionStageIssues(p, 'shot', { images: false, storyboard: false }), [])
  delete p.props.letter.generation.details.appearance
  delete p.shots.shot.imageGeneration
  p.shots.shot.videoGeneration.prompt = ''
  const issues = productionStageIssues(p, 'shot', { images: false, storyboard: false })
  assert.ok(issues.some((i) => i.id === 'letter'))
  assert.ok(issues.some((i) => i.stage === 'storyboard'))
  assert.ok(issues.some((i) => i.stage === 'media'))
})

test('dependency graph orders parent image before variant, all references before preview and video', () => {
  const { p } = fixture()
  const tasks = dramaProductionTasks(p, { runId: 'run', shotIds: ['shot'], input: {}, assemble: false })
  const variant = tasks.find((t) => t.scopeId === 'wet-letter')
  assert.deepEqual(variant.dependencies, ['run:reference:prop:letter'])
  assert.ok(tasks.find((t) => t.kind === 'render-storyboard').dependencies.includes(variant.id))
  assert.ok(tasks.find((t) => t.kind === 'render-shot').dependencies.includes('run:storyboard:shot'))
  const rework = reworkTasks(p, { runId: 'redo', kind: 'script', id: 'ep', input: {} })
  assert.deepEqual(rework.map((t) => t.input.phase || t.kind), ['revise-text', 'assets', 'shots', 'prompts'])
})

test('prompt authoring rejects missing and duplicate shots and late results after an operator edit', () => {
  const { p, images, videos } = fixture()
  for (const request of shotPromptRequests(p, p.episodes.ep)) {
    assert.throws(() => request.validate({ shots: [] }), /尚未编写/)
  }
  const late = mergeShotPrompts(p, p.episodes.ep, images, videos)
  assert.throws(() => applyCreativeProposal(structuredClone(p), { kind: 'shot_prompts', payload: { ...late, shots: [] } }), /遗漏/)
  assert.throws(() => applyCreativeProposal(structuredClone(p), { kind: 'shot_prompts', payload: { ...late, shots: [...late.shots, ...late.shots] } }), /重复/)
  const value = generation('video', 'The traveler slowly opens the letter, five seconds, stationary camera; no speech.')
  editGeneration(p, 'video-prompt', 'shot', { prompt: value.prompt, negativePrompt: value.negativePrompt, ...value.details })
  assert.throws(() => applyCreativeProposal(p, { kind: 'shot_prompts', payload: late }), /过期/)
})

test('editing only video prompt preserves preview; image changes invalidate dependent media', () => {
  const { p } = fixture()
  const shot = p.shots.shot
  p.assets.preview = { id: 'preview', kind: 'image', status: 'approved', dependsOn: ['shot'] }
  p.assets.clip = { id: 'clip', kind: 'video', status: 'approved', dependsOn: ['shot'] }
  shot.storyboardAssetId = 'preview'; shot.approvedAssetId = 'clip'; shot.assetIds = ['clip']
  p.timelines.timeline = { id: 'timeline', status: 'ready', assetIds: ['clip'] }
  p.deliverables.final = { id: 'final', status: 'ready', timelineId: 'timeline' }
  const signature = preparationSignature(shot)
  const next = generation('video', 'The traveler carefully unfolds the letter, hold five seconds, no speech.')
  editGeneration(p, 'video-prompt', 'shot', { ...next.details, prompt: next.prompt, negativePrompt: '' })
  assert.equal(p.assets.preview.status, 'approved')
  assert.equal(preparationSignature(p.shots.shot), signature)
  assert.equal(p.assets.clip.status, 'invalidated')
  assert.equal(p.deliverables.final.status, 'invalidated')
  const image = generation('image', 'Close view of the traveler and the wet letter, realistic soft light, preserve blue coat.')
  editGeneration(p, 'image-prompt', 'shot', { ...image.details, prompt: image.prompt, negativePrompt: '' })
  assert.equal(p.assets.preview.status, 'invalidated')
})

test('variant execution snapshot records the actual parent reference and rejects swapped references or unsaved prompt', () => {
  const { p } = fixture()
  p.props.letter.referenceAssetId = 'parent-image'
  p.assets['parent-image'] = { id: 'parent-image', kind: 'image', status: 'approved', contentHash: 'parent-hash' }
  p.shots.temp = { id: 'temp', episodeId: 'legacy-main', referenceBindings: [] }
  const options = { project: p, shotId: 'temp', capability: 'image.image2image', target: { kind: 'variant', id: 'wet-letter' }, parameters: { referenceIds: ['parent-image'] } }
  const snapshot = compilePromptSnapshot(options)
  assert.equal(snapshot.target.id, 'wet-letter')
  assert.equal(snapshot.prompt, p.assetVariants['wet-letter'].generation.prompt)
  assert.equal(snapshot.references[0].assetHash, 'parent-hash')
  assert.throws(() => compilePromptSnapshot({ ...options, parameters: { referenceIds: [] } }), /参考图片/)
  assert.throws(() => compilePromptSnapshot({ ...options, prompt: 'Unsaved replacement' }), /已保存版本/)
})

test('legacy character states remain visible as incomplete variants without invented prompts', () => {
  const p = createProjectAggregate()
  p.characterStates.rain = { id: 'rain', characterId: 'traveler', description: 'Raincoat' }
  const normalized = parseProject(p)
  assert.equal(normalized.assetVariants.rain.parentId, 'traveler')
  assert.equal(normalized.assetVariants.rain.generation, null)
})
