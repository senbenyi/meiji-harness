import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { DeliveryService } from '../../lib/delivery/export.js'
import { detectFfmpeg } from '../../lib/concat.js'

async function cmd(service, projectId, type, payload) {
  const project = await service.getProject(projectId)
  return service.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type, payload })
}

async function exportFixture(root) {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await projects.createProject({ payload: { title: '导出测试', productionSpec: { contentRating: 'adult' } } })
  const projectId = created.project.id

  await cmd(projects, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await cmd(projects, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await cmd(projects, projectId, 'upsertEpisode', { id: 'legacy-main', title: '集一' })
  const s1 = await cmd(projects, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头1', status: 'ready' })
  const s2 = await cmd(projects, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头2', status: 'ready' })

  // create two approved assets with stub video files
  const assetIds = []
  for (const shot of [s1, s2]) {
    const attempt = await cmd(projects, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'submitting' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'queued' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'running' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'downloading' })

    const assetId = `${attempt.output.attemptId}-output-0`
    const logicalKey = `canvas/test/${assetId}.mp4`
    const absPath = join(root, logicalKey)
    await mkdir(join(root, 'canvas', 'test'), { recursive: true })
    await writeFile(absPath, `fake-video-${assetId}`)

    await cmd(projects, projectId, 'completeGenerationAttempt', {
      attemptId: attempt.output.attemptId, assetId, kind: 'video',
      logicalKey, contentHash: 'abc', bytes: 100,
    })

    // approve via review
    const project = await projects.getProject(projectId)
    const reviewTaskId = Object.keys(project.reviewTasks).find(
      (id) => project.reviewTasks[id].targetId === assetId
    )
    await cmd(projects, projectId, 'recordReviewDecision', { reviewTaskId, decision: 'approved', reason: 'ok', answerer: 'tester' })
    assetIds.push(assetId)
  }

  // assemble timeline
  const timeline = await cmd(projects, projectId, 'assembleTimeline', { episodeId: ep.output.id, assetIds })
  return { projects, projectId, timelineId: timeline.output.timelineId, assetIds }
}

test('DeliveryService.plan creates a planned deliverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-export-plan-'))
  try {
    const { projects, projectId, timelineId } = await exportFixture(root)
    const delivery = new DeliveryService(projects)
    const result = await delivery.plan(projectId, timelineId)
    const d = result.project.deliverables[result.output.deliverableId]
    assert.equal(d.status, 'planned')
    assert.equal(d.timelineId, timelineId)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('DeliveryService.execute with invalid stubs transitions planned → exporting → failed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-export-exec-'))
  try {
    const { projects, projectId, timelineId } = await exportFixture(root)
    const delivery = new DeliveryService(projects)
    const planned = await delivery.plan(projectId, timelineId)
    const deliverableId = planned.output.deliverableId
    // ffmpeg will fail on fake video bytes — verifies the failure path
    await assert.rejects(delivery.execute(projectId, deliverableId, root), /concat/)
    const d = (await projects.getProject(projectId)).deliverables[deliverableId]
    assert.equal(d.status, 'failed')
    assert.ok(d.lastError)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('DeliveryService.execute marks failed on empty timeline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-export-fail-'))
  try {
    const projects = await new ProjectService(new MemoryProjectRepository()).open()
    const created = await projects.createProject({ payload: { title: '空导出', productionSpec: { contentRating: 'adult' } } })
    const projectId = created.project.id
    await cmd(projects, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
    await cmd(projects, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
    const ep = await cmd(projects, projectId, 'upsertEpisode', { id: 'legacy-main', title: '集' })
    const timeline = await cmd(projects, projectId, 'assembleTimeline', { episodeId: ep.output.id, assetIds: [] })

    const delivery = new DeliveryService(projects)
    const planned = await delivery.plan(projectId, timeline.output.timelineId)
    const deliverableId = planned.output.deliverableId

    await assert.rejects(delivery.execute(projectId, deliverableId, root), /export-empty-timeline/)
    const d = (await projects.getProject(projectId)).deliverables[deliverableId]
    assert.equal(d.status, 'failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('startDeliverableExport/completeDeliverableExport/failDeliverableExport transitions are valid', async () => {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await projects.createProject({ payload: { title: '状态机', productionSpec: { contentRating: 'adult' } } })
  const projectId = created.project.id
  await cmd(projects, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await cmd(projects, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await cmd(projects, projectId, 'upsertEpisode', { id: 'legacy-main', title: '集' })
  const tl = await cmd(projects, projectId, 'assembleTimeline', { episodeId: ep.output.id, assetIds: [] })
  const plan = await cmd(projects, projectId, 'planDeliverable', { timelineId: tl.output.timelineId })
  const deliverableId = plan.output.deliverableId

  // planned → exporting
  await cmd(projects, projectId, 'startDeliverableExport', { deliverableId })
  assert.equal((await projects.getProject(projectId)).deliverables[deliverableId].status, 'exporting')

  // exporting → ready
  await cmd(projects, projectId, 'completeDeliverableExport', { deliverableId, contentHash: 'abc', logicalKey: 'exports/test.mp4' })
  assert.equal((await projects.getProject(projectId)).deliverables[deliverableId].status, 'ready')
})

test('DeliveryService.execute rejects path traversal in asset logicalKey', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-export-traverse-'))
  try {
    const projects = await new ProjectService(new MemoryProjectRepository()).open()
    const created = await projects.createProject({ payload: { title: '遍历测试', productionSpec: { contentRating: 'adult' } } })
    const projectId = created.project.id
    await cmd(projects, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
    await cmd(projects, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
    const ep = await cmd(projects, projectId, 'upsertEpisode', { id: 'legacy-main', title: '集' })
    const shot = await cmd(projects, projectId, 'upsertShot', { episodeId: ep.output.id, title: '镜头', status: 'ready' })
    const attempt = await cmd(projects, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'submitting' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'queued' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'running' })
    await cmd(projects, projectId, 'advanceGenerationAttempt', { attemptId: attempt.output.attemptId, status: 'downloading' })
    // Use path traversal in logicalKey
    await cmd(projects, projectId, 'completeGenerationAttempt', {
      attemptId: attempt.output.attemptId, assetId: 'bad-asset', kind: 'video',
      logicalKey: '../../../etc/passwd', contentHash: 'abc', bytes: 100,
    })
    const project = await projects.getProject(projectId)
    const reviewTaskId = Object.keys(project.reviewTasks).find((id) => project.reviewTasks[id].targetId === 'bad-asset')
    await cmd(projects, projectId, 'recordReviewDecision', { reviewTaskId, decision: 'approved', answerer: 'tester' })
    await cmd(projects, projectId, 'assembleTimeline', { episodeId: ep.output.id, assetIds: ['bad-asset'] })

    const project2 = await projects.getProject(projectId)
    const timelineId = Object.keys(project2.timelines)[0]
    const delivery = new DeliveryService(projects)
    const planned = await delivery.plan(projectId, timelineId)
    await assert.rejects(
      delivery.execute(projectId, planned.output.deliverableId, root),
      /export-path-traversal/,
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('failDeliverableExport transitions exporting → failed', async () => {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await projects.createProject({ payload: { title: '失败', productionSpec: { contentRating: 'adult' } } })
  const projectId = created.project.id
  await cmd(projects, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await cmd(projects, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await cmd(projects, projectId, 'upsertEpisode', { id: 'legacy-main', title: '集' })
  const tl = await cmd(projects, projectId, 'assembleTimeline', { episodeId: ep.output.id, assetIds: [] })
  const plan = await cmd(projects, projectId, 'planDeliverable', { timelineId: tl.output.timelineId })
  const deliverableId = plan.output.deliverableId

  await cmd(projects, projectId, 'startDeliverableExport', { deliverableId })
  await cmd(projects, projectId, 'failDeliverableExport', { deliverableId, error: 'test error' })
  const d = (await projects.getProject(projectId)).deliverables[deliverableId]
  assert.equal(d.status, 'failed')
  assert.equal(d.lastError, 'test error')
})
