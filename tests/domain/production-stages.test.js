import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectAggregate } from '../../lib/domain/spec.js'
import { commandHandlers } from '../../lib/domain/commands/index.js'
import { productionCommandHandlers } from '../../lib/domain/production.js'
import { assertProductionStages, preparationSignature } from '../../lib/domain/policies.js'
import { canvasReadModel } from '../../lib/domain/read-models.js'
import { canvasStageForNode } from '../../studio/stages.js'
import { dramaProductionTasks } from '../../lib/production/drama.js'

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
  return p
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
    [(p) => { p.shots.s.prompt = 'Different action' }, 'storyboard'],
  ]) {
    const p = prepared()
    remove(p)
    assert.throws(() => assertProductionStages(p, 's'), new RegExp(stage))
  }
  const p = prepared()
  const result = commandHandlers.createGenerationAttempt(p, { shotId: 's', capability: 'video.reference2video' }, { commandId: 'test' })
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
