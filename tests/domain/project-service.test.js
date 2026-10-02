import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { studioDomainSpec } from '../../lib/domain/spec.js'

test('Harness Storage descriptor names use identifier-safe syntax', () => {
  const unitName = /^[a-z][a-z0-9_]*$/
  assert.match(studioDomainSpec.name, unitName)
  for (const tableName of Object.keys(studioDomainSpec.tables)) assert.match(tableName, unitName)
})

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

test('generation attempt freezes a validated prompt snapshot', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const episode = await command(service, projectId, 'upsertEpisode', { title: '第一集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: episode.output.id, title: '镜头', status: 'ready', prompt: 'test prompt' })
  const { compilePromptSnapshot } = await import('../../lib/prompts/compiler.js')
  const project = await service.getProject(projectId)
  const snapshot = compilePromptSnapshot({ project, shotId: shot.output.id, capability: 'image.text2image' })
  const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'image.text2image', inputSnapshot: snapshot })
  assert.deepEqual(attempt.project.attempts[attempt.output.attemptId].inputSnapshot, snapshot)
  const changed = structuredClone(snapshot)
  changed.prompt = 'tampered'
  await assert.rejects(
    command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'image.text2image', inputSnapshot: changed }),
    /prompt snapshot hash mismatch/,
  )
})

test('download failure can resume the same attempt without a new submission', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const episode = await command(service, projectId, 'upsertEpisode', { title: '第一集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: episode.output.id, title: '镜头', status: 'ready' })
  const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
  const attemptId = attempt.output.attemptId
  await command(service, projectId, 'markAttemptSubmitted', { attemptId, promptId: 'prompt-1' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId, status: 'running' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId, status: 'downloading' })
  await command(service, projectId, 'failGenerationAttempt', { attemptId, error: 'download failed', failureClass: 'download_failure', retryable: true, failureStage: 'download' })
  const resumed = await command(service, projectId, 'recoverGenerationAttempt', { attemptId, decision: 'resume' })
  assert.equal(resumed.project.attempts[attemptId].status, 'downloading')
  assert.equal(resumed.project.attempts[attemptId].promptId, 'prompt-1')
})

test('recordAutomatedCheck pass keeps awaiting_human, fail auto-rejects', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await command(service, projectId, 'upsertEpisode', { title: '集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头', status: 'ready' })
  const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
  await command(service, projectId, 'markAttemptSubmitted', { attemptId: attempt.output.attemptId, promptId: 'p1' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'running' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'downloading' })
  const completed = await command(service, projectId, 'completeGenerationAttempt', { attemptId: attempt.output.attemptId, kind: 'video', logicalKey: 'media/a.mp4', contentHash: 'abc' })
  const { assetId, reviewTaskId } = completed.output

  // pass → stays awaiting_human
  const passResult = await command(service, projectId, 'recordAutomatedCheck', { reviewTaskId, adapter: 'metadata', schemaVersion: 1, inputHash: 'abc', result: 'pass' })
  assert.equal(passResult.output.autoRejected, false)
  assert.equal(passResult.project.reviewTasks[reviewTaskId].status, 'awaiting_human')
  assert.equal(passResult.project.assets[assetId].status, 'candidate')

  // Now test fail path: create a second asset with its own review task
  const shot2 = await command(service, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头2', status: 'ready' })
  const attempt2 = await command(service, projectId, 'createGenerationAttempt', { shotId: shot2.output.id, capability: 'video.image2video' })
  await command(service, projectId, 'markAttemptSubmitted', { attemptId: attempt2.output.attemptId, promptId: 'p2' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt2.output.attemptId, status: 'running' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt2.output.attemptId, status: 'downloading' })
  const completed2 = await command(service, projectId, 'completeGenerationAttempt', { attemptId: attempt2.output.attemptId, kind: 'video', logicalKey: 'media/b.mp4', contentHash: 'def' })
  const reviewTaskId2 = completed2.output.reviewTaskId
  const assetId2 = completed2.output.assetId

  // fail → auto-rejected, asset rejected, shot back to ready
  const failResult = await command(service, projectId, 'recordAutomatedCheck', { reviewTaskId: reviewTaskId2, adapter: 'nsfw', schemaVersion: 1, inputHash: 'def', result: 'fail' })
  assert.equal(failResult.output.autoRejected, true)
  assert.equal(failResult.project.reviewTasks[reviewTaskId2].status, 'rejected')
  assert.equal(failResult.project.assets[assetId2].status, 'rejected')
  assert.equal(failResult.project.shots[shot2.output.id].status, 'ready')
})
