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

test('new project ids are sortable Asia/Shanghai timestamps without separators', async () => {
  const service = await new ProjectService(new MemoryProjectRepository()).open()
  const first = await service.createProject({ payload: { title: '一' } })
  const second = await service.createProject({ payload: { title: '二' } })
  assert.match(first.project.id, /^\d{17}$/)
  assert.match(second.project.id, /^\d{17}$/)
  assert.ok(second.project.id > first.project.id)
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
  assert.equal(resumed.project.shots[shot.output.id].status, 'generating')
})

test('failing one of multiple active attempts keeps the shot generating', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const episode = await command(service, projectId, 'upsertEpisode', { title: '第一集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: episode.output.id, title: '镜头', status: 'ready' })
  const first = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
  const second = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })

  const firstFailed = await command(service, projectId, 'failGenerationAttempt', { attemptId: first.output.attemptId, error: 'first failed' })
  assert.equal(firstFailed.project.shots[shot.output.id].status, 'generating')

  const secondFailed = await command(service, projectId, 'failGenerationAttempt', { attemptId: second.output.attemptId, error: 'second failed' })
  assert.equal(secondFailed.project.shots[shot.output.id].status, 'ready')
})

test('cancelGenerationAttempt uses transition and enforces state machine', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await command(service, projectId, 'upsertEpisode', { title: '集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头', status: 'ready' })
  const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
  const attemptId = attempt.output.attemptId
  await command(service, projectId, 'markAttemptSubmitted', { attemptId, promptId: 'p1' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId, status: 'running' })

  const cancelled = await command(service, projectId, 'cancelGenerationAttempt', { attemptId, reason: 'user abort' })
  assert.equal(cancelled.project.attempts[attemptId].status, 'cancelled')
  assert.equal(cancelled.project.attempts[attemptId].cancelReason, 'user abort')

  // Cannot cancel a terminal attempt
  await assert.rejects(
    command(service, projectId, 'cancelGenerationAttempt', { attemptId }),
    /illegal attempt transition/,
  )
})

test('cancelGenerationAttempt works from downloading state', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await command(service, projectId, 'upsertEpisode', { title: '集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头', status: 'ready' })
  const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
  const attemptId = attempt.output.attemptId
  await command(service, projectId, 'markAttemptSubmitted', { attemptId, promptId: 'p1' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId, status: 'running' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId, status: 'downloading' })

  const cancelled = await command(service, projectId, 'cancelGenerationAttempt', { attemptId })
  assert.equal(cancelled.project.attempts[attemptId].status, 'cancelled')
})

test('batchRecordReviewDecisions processes multiple decisions in one command', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await command(service, projectId, 'upsertEpisode', { title: '集' })

  // Create 3 shots, generate, and complete each to get review tasks
  const reviewTaskIds = []
  const shotIds = []
  for (let i = 0; i < 3; i++) {
    const shot = await command(service, projectId, 'upsertShot', { episodeId: ep.output.id, title: `镜头${i}`, status: 'ready' })
    shotIds.push(shot.output.id)
    const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
    await command(service, projectId, 'markAttemptSubmitted', { attemptId: attempt.output.attemptId, promptId: `p${i}` })
    await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'running' })
    await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'downloading' })
    const completed = await command(service, projectId, 'completeGenerationAttempt', { attemptId: attempt.output.attemptId, kind: 'video', logicalKey: `media/${i}.mp4`, contentHash: `h${i}` })
    reviewTaskIds.push(completed.output.reviewTaskId)
  }

  const batchResult = await command(service, projectId, 'batchRecordReviewDecisions', {
    decisions: [
      { reviewTaskId: reviewTaskIds[0], decision: 'approved', reason: 'good' },
      { reviewTaskId: reviewTaskIds[1], decision: 'rejected', reason: 'bad' },
      { reviewTaskId: reviewTaskIds[2], decision: 'approved' },
    ],
    answerer: 'batch-tester',
  })

  assert.equal(batchResult.output.approved, 2)
  assert.equal(batchResult.output.rejected, 1)
  assert.equal(batchResult.output.skipped, 0)
  assert.equal(batchResult.project.reviewTasks[reviewTaskIds[0]].status, 'approved')
  assert.equal(batchResult.project.reviewTasks[reviewTaskIds[1]].status, 'rejected')
  assert.equal(batchResult.project.shots[shotIds[1]].status, 'ready')
})

test('batchRecordReviewDecisions skips non-awaiting_human tasks and reports errors', async () => {
  const { service, projectId } = await fixture()
  const result = await command(service, projectId, 'batchRecordReviewDecisions', {
    decisions: [
      { reviewTaskId: 'nonexistent', decision: 'approved' },
      { reviewTaskId: 'also-missing', decision: 'invalid-decision' },
    ],
  })
  assert.equal(result.output.approved, 0)
  assert.equal(result.output.errors.length, 2)
})

test('upsertShot cross-episode reassignment cleans old episode shotIds', async () => {
  const { service, projectId } = await fixture()
  const ep1 = await command(service, projectId, 'upsertEpisode', { title: '集一' })
  const ep2 = await command(service, projectId, 'upsertEpisode', { title: '集二' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: ep1.output.id, title: '移动镜头', status: 'ready' })
  const shotId = shot.output.id

  // Shot is in ep1
  let project = await service.getProject(projectId)
  assert.ok(project.episodes[ep1.output.id].shotIds.includes(shotId))

  // Move shot to ep2
  await command(service, projectId, 'upsertShot', { shotId, episodeId: ep2.output.id, title: '移动镜头' })
  project = await service.getProject(projectId)
  assert.ok(!project.episodes[ep1.output.id].shotIds.includes(shotId), 'shot removed from old episode')
  assert.ok(project.episodes[ep2.output.id].shotIds.includes(shotId), 'shot added to new episode')
})

test('createReviewTask deduplicates active tasks for same target', async () => {
  const { service, projectId } = await fixture()
  const first = await command(service, projectId, 'createReviewTask', { targetType: 'asset', targetId: 'asset-1' })
  const second = await command(service, projectId, 'createReviewTask', { targetType: 'asset', targetId: 'asset-1' })
  assert.equal(second.output.reviewTaskId, first.output.reviewTaskId)
  assert.equal(second.output.reused, true)
})

test('assembleTimeline marks approved shots as assembled', async () => {
  const { service, projectId } = await fixture()
  await command(service, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(service, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await command(service, projectId, 'upsertEpisode', { title: '集' })
  const shot = await command(service, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头', status: 'ready' })
  const shotId = shot.output.id
  const attempt = await command(service, projectId, 'createGenerationAttempt', { shotId, capability: 'video.image2video' })
  await command(service, projectId, 'markAttemptSubmitted', { attemptId: attempt.output.attemptId, promptId: 'p' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'running' })
  await command(service, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'downloading' })
  const completed = await command(service, projectId, 'completeGenerationAttempt', { attemptId: attempt.output.attemptId, kind: 'video', logicalKey: 'media/a.mp4', contentHash: 'abc' })
  const { assetId, reviewTaskId } = completed.output
  await command(service, projectId, 'recordReviewDecision', { reviewTaskId, decision: 'approved', answerer: 'tester' })

  const timeline = await command(service, projectId, 'assembleTimeline', { episodeId: ep.output.id, assetIds: [assetId] })
  assert.equal(timeline.project.shots[shotId].status, 'assembled')
})

test('recordAutomatedCheck creates reviewDecision audit record on auto-reject', async () => {
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
  const { reviewTaskId } = completed.output

  const result = await command(service, projectId, 'recordAutomatedCheck', { reviewTaskId, adapter: 'nsfw', schemaVersion: 1, inputHash: 'abc', result: 'fail' })
  assert.equal(result.output.autoRejected, true)
  const task = result.project.reviewTasks[reviewTaskId]
  assert.ok(task.decisionId, 'should have decisionId')
  const decision = result.project.reviewDecisions[task.decisionId]
  assert.equal(decision.decision, 'rejected')
  assert.match(decision.answerer, /automated:nsfw/)
  assert.match(decision.reason, /auto-rejected/)
})

test('recordAutomatedCheck rejects on terminal task status', async () => {
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
  const { reviewTaskId } = completed.output

  // approve first
  await command(service, projectId, 'recordReviewDecision', { reviewTaskId, decision: 'approved', answerer: 'tester' })
  // try to add check to approved task
  await assert.rejects(
    command(service, projectId, 'recordAutomatedCheck', { reviewTaskId, adapter: 'nsfw', schemaVersion: 1, inputHash: 'abc', result: 'pass' }),
    /illegal review transition/,
  )
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
