import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ComfyClient } from '../../lib/comfy/client.js'
import { GenerationRunner } from '../../lib/media/generation.js'
import { recoveryPlan } from '../../lib/media/recovery.js'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { FileService } from '../../lib/storage/files.js'

async function command(service, projectId, type, payload) {
  const project = await service.getProject(projectId)
  return service.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type, payload })
}

async function generationFixture() {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await projects.createProject({ payload: { title: '生成测试', productionSpec: { contentRating: 'adult' } } })
  const projectId = created.project.id
  await command(projects, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await command(projects, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const episode = await command(projects, projectId, 'upsertEpisode', { title: '第一集' })
  const shot = await command(projects, projectId, 'upsertShot', { episodeId: episode.output.id, title: '镜头', status: 'ready' })
  const attempt = await command(projects, projectId, 'createGenerationAttempt', { shotId: shot.output.id, capability: 'video.image2video' })
  return { projects, projectId, attemptId: attempt.output.attemptId }
}

test('GenerationRunner persists prompt, downloads, atomically publishes, then creates candidate asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-generation-'))
  try {
    const { projects, projectId, attemptId } = await generationFixture()
    const fetchImpl = async (url) => {
      if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'prompt-1' })
      if (url.includes('/history/')) return Response.json({ 'prompt-1': { status: { completed: true }, outputs: { 9: { videos: [{ filename: 'clip.mp4', type: 'output' }] } } } })
      if (url.includes('/view?')) return new Response(Buffer.from('video-bytes'))
      throw new Error(`unexpected URL: ${url}`)
    }
    const runner = new GenerationRunner({
      projectService: projects,
      comfyClient: new ComfyClient({ baseUrl: 'https://comfy.example', fetchImpl, pollMs: 1 }),
      fileService: await new FileService(root).initialize(),
    })
    const result = await runner.run({ projectId, attemptId, graph: { 1: { class_type: 'Test', inputs: {} } } })
    const asset = result.project.assets[result.output.assetId]
    assert.equal(result.project.attempts[attemptId].status, 'completed')
    assert.equal(asset.status, 'candidate')
    assert.match(asset.logicalKey, /^media\//)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('submission response loss becomes submission_unknown and requires explicit confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-generation-unknown-'))
  try {
    const { projects, projectId, attemptId } = await generationFixture()
    const runner = new GenerationRunner({
      projectService: projects,
      comfyClient: new ComfyClient({ baseUrl: 'https://comfy.example', fetchImpl: async () => { throw new Error('network lost') } }),
      fileService: await new FileService(root).initialize(),
    })
    await assert.rejects(runner.submit({ projectId, attemptId, graph: {} }), /network lost/)
    const project = await projects.getProject(projectId)
    assert.equal(project.attempts[attemptId].status, 'submission_unknown')
    assert.equal(recoveryPlan(project)[0].automatic, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
