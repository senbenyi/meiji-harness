import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { BatchRunner } from '../../lib/media/batch.js'

async function cmd(service, projectId, type, payload) {
  const project = await service.getProject(projectId)
  return service.execute({ projectId, commandId: randomUUID(), expectedRevision: project.revision, type, payload })
}

async function makeFixture({ shotCount = 3, readyCount } = {}) {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const created = await projects.createProject({ payload: { title: '批量测试', productionSpec: { contentRating: 'adult' } } })
  const projectId = created.project.id
  await cmd(projects, projectId, 'recordRights', { kind: 'age_confirmation', subjectAdult: true })
  await cmd(projects, projectId, 'recordRights', { kind: 'consent', scope: ['generation'] })
  const ep = await cmd(projects, projectId, 'upsertEpisode', { title: '集一' })
  const episodeId = ep.output.id

  const shots = []
  const ready = readyCount ?? shotCount
  for (let i = 0; i < shotCount; i++) {
    const status = i < ready ? 'ready' : 'planned'
    const s = await cmd(projects, projectId, 'upsertShot', {
      episodeId, title: `镜头${i + 1}`, prompt: `prompt for shot ${i + 1}`, status,
    })
    shots.push(s.output)
  }

  return { projects, projectId, episodeId, shots }
}

test('BatchRunner generates all ready shots in episode', async () => {
  const { projects, projectId, episodeId } = await makeFixture({ shotCount: 3 })
  const runner = new BatchRunner({ getProject: (pid) => projects.getProject(pid) })
  const generated = []

  const result = await runner.run({
    projectId,
    episodeId,
    generateFn: async (shot) => {
      generated.push(shot.id)
      return { media: `fake-${shot.id}.mp4` }
    },
  })

  assert.equal(result.total, 3)
  assert.equal(result.completed, 3)
  assert.equal(result.failed, 0)
  assert.equal(result.skipped, 0)
  assert.equal(generated.length, 3)
})

test('BatchRunner skips non-ready shots', async () => {
  const { projects, projectId, episodeId } = await makeFixture({ shotCount: 4, readyCount: 2 })
  const runner = new BatchRunner({ getProject: (pid) => projects.getProject(pid) })

  const result = await runner.run({
    projectId,
    episodeId,
    generateFn: async (shot) => ({ media: `fake-${shot.id}.mp4` }),
  })

  assert.equal(result.total, 4)
  assert.equal(result.completed, 2)
  assert.equal(result.skipped, 2)
})

test('BatchRunner isolates per-shot failures', async () => {
  const { projects, projectId, episodeId, shots } = await makeFixture({ shotCount: 3 })
  const runner = new BatchRunner({ getProject: (pid) => projects.getProject(pid) })
  const failId = shots[1].id

  const result = await runner.run({
    projectId,
    episodeId,
    generateFn: async (shot) => {
      if (shot.id === failId) throw new Error('comfy timeout')
      return { media: `ok-${shot.id}.mp4` }
    },
  })

  assert.equal(result.total, 3)
  assert.equal(result.completed, 2)
  assert.equal(result.failed, 1)
  const failedResult = result.results.find((r) => r.shotId === failId)
  assert.equal(failedResult.status, 'failed')
  assert.match(failedResult.error, /comfy timeout/)
})

test('BatchRunner works with explicit shotIds', async () => {
  const { projects, projectId, shots } = await makeFixture({ shotCount: 3 })
  const runner = new BatchRunner({ getProject: (pid) => projects.getProject(pid) })
  const pick = [shots[0].id, shots[2].id]

  const result = await runner.run({
    projectId,
    shotIds: pick,
    generateFn: async (shot) => ({ id: shot.id }),
  })

  assert.equal(result.total, 2)
  assert.equal(result.completed, 2)
})

test('BatchRunner returns empty result for episode with no ready shots', async () => {
  const { projects, projectId, episodeId } = await makeFixture({ shotCount: 2, readyCount: 0 })
  const runner = new BatchRunner({ getProject: (pid) => projects.getProject(pid) })

  const result = await runner.run({
    projectId,
    episodeId,
    generateFn: async () => { throw new Error('should not be called') },
  })

  assert.equal(result.total, 2)
  assert.equal(result.completed, 0)
  assert.equal(result.skipped, 2)
})

test('BatchRunner throws on missing episodeId and shotIds', async () => {
  const { projects, projectId } = await makeFixture()
  const runner = new BatchRunner({ getProject: (pid) => projects.getProject(pid) })

  await assert.rejects(
    runner.run({ projectId, generateFn: async () => ({}) }),
    /batch requires episodeId or shotIds/,
  )
})

test('BatchRunner throws on unknown shotId', async () => {
  const { projects, projectId } = await makeFixture()
  const runner = new BatchRunner({ getProject: (pid) => projects.getProject(pid) })

  await assert.rejects(
    runner.run({ projectId, shotIds: ['nonexistent'], generateFn: async () => ({}) }),
    /shot not found/,
  )
})
