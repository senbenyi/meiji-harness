import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'

async function command(service, projectId, type, payload, options = {}) {
  const project = await service.getProject(projectId)
  return service.execute({
    projectId,
    commandId: options.commandId || randomUUID(),
    expectedRevision: options.expectedRevision ?? project.revision,
    type,
    payload,
  })
}

async function fixture() {
  const service = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await service.createProject({ payload: { title: '测试短剧', productionSpec: { contentRating: 'adult' } } })
  return { service, projectId: created.project.id }
}

test('revision CAS and command idempotency reject stale or changed commands', async () => {
  const { service, projectId } = await fixture()
  const project = await service.getProject(projectId)
  const commandId = randomUUID()
  const first = await service.execute({ projectId, commandId, expectedRevision: project.revision, type: 'updateProductionSpec', payload: { episodeCount: 2 } })
  const replay = await service.execute({ projectId, commandId, expectedRevision: project.revision, type: 'updateProductionSpec', payload: { episodeCount: 2 } })
  assert.equal(replay.project.revision, first.project.revision)
  await assert.rejects(
    service.execute({ projectId, commandId, expectedRevision: first.project.revision, type: 'updateProductionSpec', payload: { episodeCount: 3 } }),
    (error) => error.code === 'conflict',
  )
  await assert.rejects(
    service.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type: 'updateProductionSpec', payload: { episodeCount: 4 } }),
    (error) => error.code === 'conflict',
  )
})

test('generation persists attempt before submission and requires human review before timeline', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation', 'delivery'] })
  const episode = await command(service, projectId, 'upsertEpisode', { title: '第一集' })
  const episodeId = episode.output.id
  const shot = await command(service, projectId, 'upsertShot', { episodeId, title: '镜头一', status: 'ready' })
  const shotId = shot.output.id
  const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId, capability: 'video.image2video' })
  const attemptId = attempt.output.attemptId
  assert.equal(attempt.project.attempts[attemptId].status, 'created')
  await command(service, projectId, 'markAttemptSubmitted', { attemptId, promptId: 'prompt-1' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId, status: 'running' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId, status: 'downloading' })
  const completed = await command(service, projectId, 'completeGenerationAttempt', { attemptId, kind: 'video', logicalKey: 'media/a.mp4', contentHash: 'abc' })
  const { assetId, reviewTaskId } = completed.output
  await assert.rejects(command(service, projectId, 'assembleTimeline', { episodeId, assetIds: [assetId] }), /must be approved/)
  await command(service, projectId, 'recordAutomatedCheck', { reviewTaskId, adapter: 'metadata', schemaVersion: 1, inputHash: 'abc', result: 'pass' })
  const decision = await command(service, projectId, 'recordReviewDecision', { reviewTaskId, decision: 'approved', answerer: 'tester' })
  assert.equal(decision.project.assets[assetId].status, 'approved')
  assert.equal(decision.project.shots[shotId].approvedAssetId, assetId)
  const timeline = await command(service, projectId, 'assembleTimeline', { episodeId, assetIds: [assetId] })
  assert.equal(timeline.project.timelines[timeline.output.timelineId].status, 'ready')
})

test('adult project cannot generate without age and rights records', async () => {
  const { service, projectId } = await fixture()
  const episode = await command(service, projectId, 'upsertEpisode', { title: '第一集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: episode.output.id, title: '镜头', status: 'ready' })
  await assert.rejects(
    command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'image.text2image' }),
    /rights gate blocked/,
  )
})
