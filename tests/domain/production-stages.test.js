import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectAggregate } from '../../lib/domain/spec.js'
import { commandHandlers } from '../../lib/domain/commands/index.js'
import { productionCommandHandlers } from '../../lib/domain/production.js'
import { assertProductionStages, preparationSignature } from '../../lib/domain/policies.js'
import { canvasReadModel } from '../../lib/domain/read-models.js'
import { canvasStageForNode } from '../../studio/stages.js'
import { dramaProductionTasks } from '../../lib/production/drama.js'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { productionEditor } from '../../lib/domain/rework.js'
import { authorFixture } from '../helpers/generation.js'
import { compilePromptSnapshot } from '../../lib/prompts/compiler.js'

function fixture() {
  const p = createProjectAggregate({ id: 'drama' })
  p.sourceDocuments.source = { id: 'source', contentHash: 'source-hash', characters: 100 }
  const sourceRefs = [{ sourceId: 'source', contentHash: 'source-hash' }]
  p.developmentProposals.analysis = { kind: 'content_analysis', status: 'approved', sourceRefs }
  p.developmentProposals.script = { kind: 'episode_script', status: 'approved', sourceRefs }
  p.storyBible = { summary: 'A detective finds a letter.', proposalId: 'analysis', sourceRefs }
  p.characters.detective = { id: 'detective', name: 'Detective', description: 'Blue coat', sourceRefs }
  p.locations.station = { id: 'station', name: 'Station', description: 'Old station', sourceRefs }
  p.episodes.ep = { id: 'ep', title: 'Letter', order: 1, status: 'draft', script: 'The detective enters the station and opens a letter.', outline: 'Find a letter.', proposalId: 'script', analysisProposalId: 'analysis', shotIds: ['s'] }
  p.shots.s = { id: 's', episodeId: 'ep', proposalId: 'script', analysisProposalId: 'analysis', status: 'planned', prompt: 'A detective opens a letter.', shotDescription: 'The detective opens the letter in the station.', duration: 7, sourceRefs, referenceBindings: [{ kind: 'character', entityId: 'detective' }, { kind: 'location', entityId: 'station' }], attemptIds: [], assetIds: [] }
  return authorFixture(p)
}

function image(p, id, entity, kind) {
  p.assets[id] = { id, kind: 'image', status: 'approved', logicalKey: `${id}.png`, contentHash: 'image-hash', bytes: 100, provenance: { preparationKind: kind, preparationSignature: preparationSignature(entity) } }
}

function prepared() {
  const p = fixture()
  for (const binding of p.shots.s.referenceBindings) {
    const entity = p[binding.kind === 'character' ? 'characters' : 'locations'][binding.entityId]
    image(p, binding.entityId, entity, binding.kind)
    commandHandlers.bindPreparationAsset(p, { kind: binding.kind, entityId: binding.entityId, assetId: binding.entityId })
  }
  image(p, 'board', p.shots.s, 'storyboard')
  commandHandlers.bindPreparationAsset(p, { kind: 'storyboard', entityId: 's', assetId: 'board' })
  return p
}

function delivered() {
  const p = prepared()
  p.assets.video = { id: 'video', kind: 'video', status: 'approved', logicalKey: 'video.mp4', contentHash: 'video', dependsOn: [] }
  p.shots.s.approvedAssetId = 'video'
  p.shots.s.assetIds = ['video']
  p.shots.s.status = 'assembled'
  p.timelines.timeline = { id: 'timeline', status: 'ready', assetIds: ['video'] }
  p.deliverables.final = { id: 'final', status: 'ready', timelineId: 'timeline', logicalKey: 'final.mp4', contentHash: 'final' }
  p.status = 'completed'
  p.episodes.ep.status = 'delivered'
  return p
}

test('editing an upstream entity invalidates legacy video and delivery with missing dependency arrays', () => {
  const p = delivered()
  commandHandlers.editProductionContent(p, { kind: 'character', id: 'detective', values: { description: 'Red coat' } }, { commandId: 'edit-character' })
  assert.equal(p.shots.s.status, 'invalidated')
  assert.equal(p.assets.video.status, 'invalidated')
  assert.equal(p.timelines.timeline.status, 'invalidated')
  assert.equal(p.deliverables.final.status, 'invalidated')
  assert.equal(p.status, 'active')
  assert.equal(canvasReadModel(p).production.stages.find((stage) => stage.key === 'delivery').completed, 0)
  assert.equal(canvasReadModel(p).nodes.find((node) => node.id === 'domain:delivery:final').presentation.historical, true)
})

test('completed shot regeneration creates a fresh durable run and duplicate command reuses it', async () => {
  const p = delivered()
  const repo = new MemoryProjectRepository()
  await repo.put(p)
  const service = new ProjectService(repo)
  const command = { projectId: p.id, expectedRevision: p.revision, commandId: 'regen-video', type: 'requestProductionRework', payload: { kind: 'video', id: 's', input: {} } }
  const first = await service.execute(command)
  const repeat = await service.execute(command)
  assert.equal(first.output.runId, repeat.output.runId)
  assert.equal(Object.keys(repeat.project.productionTasks).length, 1)
  assert.equal(repeat.project.assets.board.status, 'approved')
  assert.equal(repeat.project.assets.video.status, 'invalidated')
  assert.equal(repeat.project.deliverables.final.status, 'invalidated')
  assert.equal(repeat.project.productionTasks[first.output.taskIds[0]].kind, 'render-shot')
  await assert.rejects(service.execute({ ...command, commandId: 'second-click', expectedRevision: repeat.project.revision }), /仍有制作任务/)
})

test('assembly rework keeps approved clips and contains no render tasks', () => {
  const p = delivered()
  const result = commandHandlers.requestProductionRework(p, { kind: 'delivery', input: {} }, { commandId: 'assembly' })
  assert.deepEqual(result.taskIds.map((id) => p.productionTasks[id].kind), ['concat-video', 'deliver-drama'])
  assert.equal(p.assets.video.status, 'approved')
  assert.equal(p.deliverables.final.status, 'invalidated')
})

test('replanning removes obsolete episodes from active production and preserves their history', () => {
  const p = delivered()
  const proposal = commandHandlers.submitDevelopmentProposal(p, { proposalId: 'new-plan', kind: 'episode_plan', sourceRefs: [{ sourceId: 'source', contentHash: 'source-hash' }], payload: { episodes: [{ id: 'new-episode', order: 1, title: 'New episode', outline: 'A new plan.', sourceSpans: [{ sourceId: 'source', start: 0, end: 100 }] }] } })
  commandHandlers.recordReviewDecision(p, { reviewTaskId: proposal.reviewTaskId, decision: 'approved' })
  assert.equal(p.episodes.ep, undefined)
  assert.equal(p.contentRevisions['new-plan:ep'].before.script, 'The detective enters the station and opens a letter.')
  assert.equal(p.shots.s.supersededBy, 'new-plan')
  assert.equal(p.deliverables.final.status, 'invalidated')
  assert.deepEqual(canvasReadModel(p).presentation.episodes.map(ep => ep.id), ['new-episode'])
  assert.ok(!canvasReadModel(p).nodes.some(node => node.presentation?.shotId === 's' && !node.presentation?.historical))
})

test('regenerated media exposes previous clips as history without legacy draft actions', () => {
  const p = delivered()
  p.assets.previous = { ...p.assets.video, id: 'previous', logicalKey: 'previous.mp4', status: 'invalidated' }
  p.shots.s.assetIds.push('previous')
  p.legacyCanvas = { nodes: [{ id: 'assembly-copy', kind: 'video', media: 'old-assembly.mp4', params: { sources: ['s'] } }] }
  const nodes = canvasReadModel(p).nodes
  assert.equal(nodes.find(node => node.id === 'domain:history:previous').presentation.historical, true)
  assert.equal(nodes.find(node => node.id === 'assembly-copy').presentation.historical, true)
  assert.equal(nodes.find(node => node.id === 'domain:script:ep').status, 'ready')
})

test('display-only shot edits keep media; narrative edits require a synchronized script', () => {
  const p = delivered()
  commandHandlers.editProductionContent(p, { kind: 'shot', id: 's', values: { title: 'New name' } }, { commandId: 'rename' })
  assert.equal(p.assets.video.status, 'approved')
  assert.throws(() => commandHandlers.editProductionContent(p, { kind: 'shot', id: 's', values: { shotDescription: 'Changed action' } }, { commandId: 'bad-edit' }), /同步修改/)
  assert.ok(productionEditor(p, { kind: 'shot', id: 's' }).fields.some((field) => field.key === 'script'))
  commandHandlers.editProductionContent(p, { kind: 'shot', id: 's', values: { shotDescription: 'Changed action', script: 'Updated full script.' } }, { commandId: 'good-edit' })
  assert.equal(p.episodes.ep.script, 'Updated full script.')
  assert.equal(p.assets.video.status, 'invalidated')
})

test('saving unchanged settings and script preserves approved media', () => {
  const p = delivered()
  p.shots.s.title = 'Open the letter'
  const editor = productionEditor(p, { kind: 'script', id: 'ep' })
  const values = { script: p.episodes.ep.script, shots: editor.shots.map(shot => ({ id: shot.id, ...Object.fromEntries(shot.fields.map(field => [field.key, field.value])) })) }
  commandHandlers.editProductionContent(p, { kind: 'character', id: 'detective', values: { name: 'Detective', description: 'Blue coat' } }, { commandId: 'unchanged-character' })
  commandHandlers.editProductionContent(p, { kind: 'script', id: 'ep', values }, { commandId: 'unchanged-script' })
  assert.equal(p.assets.video.status, 'approved')
  assert.equal(p.deliverables.final.status, 'ready')
  values.shots[0].shotDescription = 'A different action'
  assert.throws(() => commandHandlers.editProductionContent(p, { kind: 'script', id: 'ep', values }, { commandId: 'inconsistent-script' }), /同步修改/)
})

test('image replacement updates the formal reference and preserves the old asset', () => {
  const p = delivered()
  commandHandlers.replacePreparationImage(p, { kind: 'character', id: 'detective', values: { logicalKey: 'new.png', contentHash: 'new', bytes: 100 } }, { commandId: 'replace' })
  assert.equal(p.characters.detective.referenceAssetId, 'replace:image')
  assert.equal(p.shots.s.referenceBindings[0].assetId, 'replace:image')
  assert.equal(p.assets.detective.status, 'invalidated')
  assert.equal(p.deliverables.final.status, 'invalidated')
})

test('drama completion requires validated delivery covering every formal shot', () => {
  const p = prepared()
  p.assets.video = { id: 'video', kind: 'video', status: 'approved', logicalKey: 'video.mp4', contentHash: 'video-hash', bytes: 100 }
  p.shots.s.approvedAssetId = 'video'
  p.timelines.timeline = { id: 'timeline', episodeId: p.id, status: 'ready', assetIds: ['video'] }
  p.deliverables.final = { id: 'final', timelineId: 'timeline', status: 'ready', logicalKey: 'final.mp4', contentHash: 'final-hash' }
  p.timelines.timeline.assetIds = []
  assert.throws(() => commandHandlers.completeDramaProduction(p, { deliverableId: 'final' }), /missing shot/)
  assert.equal(p.status, 'draft')
  p.timelines.timeline.assetIds = ['video']
  p.deliverables.final.status = 'planned'
  assert.throws(() => commandHandlers.completeDramaProduction(p, { deliverableId: 'final' }), /incomplete/)
  assert.equal(p.status, 'draft')
  p.deliverables.final.status = 'ready'
  p.assets.video.status = 'invalidated'
  assert.throws(() => commandHandlers.completeDramaProduction(p, { deliverableId: 'final' }), /timeline assets must be approved/)
  p.assets.video.status = 'approved'
  commandHandlers.completeDramaProduction(p, { deliverableId: 'final' })
  assert.equal(p.status, 'completed')
  assert.equal(p.episodes.ep.status, 'delivered')
  commandHandlers.completeDramaProduction(p, { deliverableId: 'final' })
  p.assets.board.status = 'invalidated'
  assert.throws(() => commandHandlers.completeDramaProduction(p, { deliverableId: 'final' }), /storyboard/)
})

test('single-episode generation cannot declare a multi-episode drama delivered', () => {
  const p = fixture()
  p.episodes.other = { ...p.episodes.ep, id: 'other', shotIds: ['other-shot'] }
  const tasks = dramaProductionTasks(p, { runId: 'single', shotIds: ['s'], input: {} })
  assert.ok(tasks.some((task) => task.kind === 'concat-video'))
  assert.ok(!tasks.some((task) => task.kind === 'deliver-drama'))
})

test('empty upstream stages cannot create a video attempt or change planned status', () => {
  const p = createProjectAggregate({ id: 'empty' })
  commandHandlers.upsertEpisode(p, { id: 'ep', title: 'Episode' })
  commandHandlers.upsertShot(p, { id: 's', episodeId: 'ep', status: 'planned', prompt: 'A landscape.' })
  assert.throws(() => commandHandlers.createGenerationAttempt(p, { shotId: 's', capability: 'video.reference2video' }, { commandId: 'test' }), /production stages blocked/)
  assert.equal(p.shots.s.status, 'planned')
  assert.equal(Object.keys(p.attempts).length, 0)
})

test('analysis, script, reference image and storyboard are independently enforced', () => {
  for (const [remove, stage] of [
    [(p) => { p.storyBible = null }, 'analysis'],
    [(p) => { p.episodes.ep.script = p.episodes.ep.outline }, 'scripts'],
    [(p) => { delete p.assets.detective }, 'assets'],
    [(p) => { p.assets.board.status = 'candidate' }, 'storyboard'],
    [(p) => { p.sourceDocuments.source.contentHash = 'changed' }, 'analysis'],
    [(p) => { p.characters.detective.description = 'Red coat' }, 'assets'],
    [(p) => { p.shots.s.imageGeneration.prompt = 'Different frame' }, 'storyboard'],
  ]) {
    const p = prepared()
    remove(p)
    assert.throws(() => assertProductionStages(p, 's'), new RegExp(stage))
  }
  const p = prepared()
  const inputSnapshot = compilePromptSnapshot({ project: p, shotId: 's', capability: 'video.reference2video', parameters: { referenceIds: ['detective', 'station', 'board'] } })
  const result = commandHandlers.createGenerationAttempt(p, { shotId: 's', capability: 'video.reference2video', inputSnapshot }, { commandId: 'test' })
  assert.ok(result.attemptId)
  assert.equal(p.shots.s.status, 'generating')
})

test('standalone canvas creation works, but a novel cannot bypass gates through legacy-main', () => {
  const p = createProjectAggregate({ id: 'standalone' })
  commandHandlers.upsertEpisode(p, { id: 'legacy-main', title: 'Canvas' })
  commandHandlers.upsertShot(p, { id: 's', episodeId: 'legacy-main', status: 'ready' })
  assert.ok(commandHandlers.createGenerationAttempt(p, { shotId: 's', capability: 'video.image2video' }, { commandId: 'test' }).attemptId)
  p.sourceDocuments.source = { contentHash: 'novel' }
  assert.throws(() => commandHandlers.createGenerationAttempt(p, { shotId: 's', capability: 'video.image2video' }, { commandId: 'test-2' }), /production stages blocked/)
})

test('durable task graph prepares references and storyboard before video and delivery', () => {
  const p = fixture()
  const tasks = dramaProductionTasks(p, { runId: 'run', shotIds: ['s'], input: { capability: 'video.reference2video' } })
  assert.deepEqual(tasks.map((task) => task.kind), ['render-reference', 'render-reference', 'render-storyboard', 'render-shot', 'concat-video', 'deliver-drama'])
  const board = tasks.find((task) => task.kind === 'render-storyboard')
  assert.equal(board.dependencies.length, 2)
  const video = tasks.find((task) => task.kind === 'render-shot')
  assert.ok(video.dependencies.includes(board.id))
  productionCommandHandlers.createProductionRun(p, { runId: 'run', tasks })
  assert.equal(p.productionTasks[video.id].status, 'pending')
  assert.throws(() => productionCommandHandlers.leaseProductionTask(p, { taskId: video.id, owner: 'worker' }), /not ready/)
})

test('backend worker start revalidates stages even if a video task was declared ready', () => {
  const p = fixture()
  productionCommandHandlers.createProductionRun(p, { runId: 'run', tasks: [{ id: 'video', kind: 'render-shot', scopeId: 's' }] })
  productionCommandHandlers.leaseProductionTask(p, { taskId: 'video', owner: 'worker' })
  assert.throws(() => productionCommandHandlers.startProductionTask(p, { taskId: 'video', owner: 'worker' }), /production stages blocked/)
  assert.equal(p.productionTasks.video.status, 'leased')
})

test('reference failure blocks all downstream tasks irrespective of graph insertion order', () => {
  const p = fixture()
  productionCommandHandlers.createProductionRun(p, { runId: 'run', tasks: [
    { id: 'deliver', kind: 'deliver-drama', dependencies: ['video'] },
    { id: 'video', kind: 'render-shot', dependencies: ['board'] },
    { id: 'board', kind: 'render-storyboard', dependencies: ['reference'] },
    { id: 'reference', kind: 'render-reference' },
  ] })
  productionCommandHandlers.leaseProductionTask(p, { taskId: 'reference', owner: 'worker' })
  productionCommandHandlers.startProductionTask(p, { taskId: 'reference', owner: 'worker' })
  productionCommandHandlers.failProductionTask(p, { taskId: 'reference', owner: 'worker', error: 'image failed' })
  assert.equal(p.productionTasks.deliver.status, 'blocked')
  assert.equal(p.productionRuns.run.status, 'failed')
})

test('domain data remains visible with legacy canvas; text is not presented as a storyboard image', () => {
  const p = prepared()
  p.legacyCanvas = { nodes: [{ id: 'video', kind: 'video', media: 'clip.mp4' }], settings: {} }
  const canvas = canvasReadModel(p)
  assert.ok(canvas.nodes.some((node) => node.id === 'video'))
  assert.ok(canvas.nodes.some((node) => canvasStageForNode(node) === 'analysis'))
  assert.ok(canvas.nodes.some((node) => canvasStageForNode(node) === 'assets' && node.kind === 'image'))
  assert.ok(canvas.nodes.some((node) => canvasStageForNode(node) === 'scripts' && node.content.includes('detective')))
  assert.ok(canvas.nodes.some((node) => canvasStageForNode(node) === 'storyboard' && node.kind === 'image'))
  assert.equal(canvas.nodes.filter((node) => canvasStageForNode(node) === 'storyboard' && node.kind === 'text').length, 0)
  assert.equal(p.legacyCanvas.nodes.length, 1)
})

test('whole-episode assembly refuses to silently drop a shot', () => {
  const p = prepared()
  p.episodes.ep.shotIds.push('missing')
  assert.throws(() => dramaProductionTasks(p, { runId: 'run', shotIds: ['s'], input: {} }), /partial episode assembly blocked/)
})

test('operator canvas pairs references and shots using identities without mutating the project', () => {
  const p = prepared()
  p.title = 'Operator project'
  p.episodes.second = { id: 'second', order: 2, title: 'Letter', script: 'A different episode.', shotIds: ['s2'] }
  p.shots.s2 = { ...p.shots.s, id: 's2', episodeId: 'second', storyboardAssetId: null, approvedAssetId: null }
  p.assets.orphan = { id: 'orphan', kind: 'image', logicalKey: 'orphan.png', status: 'candidate', provenance: { title: 'Detective' } }
  p.legacyCanvas = { settings: {}, nodes: [{ id: 's', kind: 'video', title: 'Letter', media: 's.mp4', params: { actualDuration: 6.5 } }] }
  const original = structuredClone(p)
  const canvas = canvasReadModel(p)
  assert.equal(canvas.presentation.title, p.title)
  assert.deepEqual(canvas.presentation.episodes.map((ep) => [ep.id, ep.number]), [['ep', 1], ['second', 2]])
  assert.equal(canvas.nodes.find((n) => n.id === 'domain:character:detective').presentation.referenceAssetId, 'detective')
  assert.equal(canvas.nodes.find((n) => n.id === 'detective').presentation.entityId, 'detective')
  assert.equal(canvas.nodes.find((n) => n.id === 'board').presentation.shotId, 's')
  assert.equal(canvas.nodes.find((n) => n.id === 'board').presentation.episodeId, 'ep')
  assert.equal(canvas.nodes.find((n) => n.id === 'orphan').presentation.role, 'unlinked')
  assert.equal(canvas.nodes.find((n) => n.id === 's').presentation.actualDuration, 6.5)
  assert.equal(canvas.nodes.find((n) => n.id === 's2:storyboard').presentation.episodeId, 'second')
  assert.deepEqual(p, original)
})

test('formal delivery remains distinct from intermediate versions and quality review', () => {
  const p = prepared()
  p.deliverables.final = { id: 'final', status: 'ready', logicalKey: 'final.mp4', contentHash: 'hash', qualityReport: { actualDuration: 7, visualReview: 'not_performed' } }
  p.legacyCanvas = { nodes: [{ id: 'assembly', kind: 'video', title: '分集成片', media: 'assembly.mp4' }], settings: {} }
  p.assets.video = { id: 'video', kind: 'video', status: 'approved', logicalKey: 'shot.mp4' }
  p.shots.s.approvedAssetId = 'video'
  const canvas = canvasReadModel(p)
  const delivery = canvas.nodes.find((node) => node.presentation?.role === 'delivery')
  assert.equal(delivery.presentation.qualityReview, 'not_performed')
  assert.equal(delivery.presentation.actualDuration, 7)
  assert.ok(canvas.nodes.some((node) => node.id === 'assembly'))
  assert.equal(canvas.nodes.find((node) => node.id === 'video').presentation.shotId, 's')
  assert.ok(!canvas.nodes.find((node) => node.presentation?.role === 'source').content.includes('SHA-256'))
  p.legacyCanvas.nodes.push({ id: 'old-video-id', kind: 'video', media: 'shot.mp4' })
  delete p.assets.board.provenance
  const historical = canvasReadModel(p)
  assert.equal(historical.nodes.find((node) => node.id === 'old-video-id').presentation.shotId, 's')
  assert.equal(historical.nodes.filter((node) => node.media === 'shot.mp4').length, 1)
  assert.equal(historical.nodes.find((node) => node.id === 'board').stage, 'storyboard')
})

test('resume preserves remote checkpoints and never steals a live worker lease', () => {
  const p = fixture()
  productionCommandHandlers.createProductionRun(p, { runId: 'run', tasks: [{ id: 'reference', kind: 'render-reference' }] })
  productionCommandHandlers.leaseProductionTask(p, { taskId: 'reference', owner: 'worker', leaseMs: 60000 })
  productionCommandHandlers.startProductionTask(p, { taskId: 'reference', owner: 'worker' })
  productionCommandHandlers.checkpointProductionTask(p, { taskId: 'reference', owner: 'worker', checkpoint: { attemptId: 'attempt', promptId: 'remote' } })
  assert.deepEqual(productionCommandHandlers.resumeProductionRun(p, { runId: 'run' }).resumedTaskIds, [])
  assert.equal(p.productionTasks.reference.owner, 'worker')
  productionCommandHandlers.failProductionTask(p, { taskId: 'reference', owner: 'worker', error: 'download failed' })
  productionCommandHandlers.resumeProductionRun(p, { runId: 'run' })
  assert.deepEqual(p.productionTasks.reference.checkpoint, { attemptId: 'attempt', promptId: 'remote' })
  assert.throws(() => productionCommandHandlers.recordProductionTaskResult(p, { taskId: 'reference', outputRef: 'invented.png' }), /production worker/)
})
