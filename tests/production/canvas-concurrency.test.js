import test from 'node:test'
import assert from 'node:assert/strict'
import { LegacyCanvasCommandAdapter, upsertCanvasNode } from '../../lib/compat/legacy-canvas-adapter.js'
import { DomainConflictError } from '../../lib/domain/errors.js'
import { canvasReadModel } from '../../lib/domain/read-models.js'
import { createProjectAggregate } from '../../lib/domain/spec.js'

test('canvas node upserts merge sibling renders instead of replacing the canvas snapshot', () => {
  const initial = { schemaVersion: 1, sessionId: 'session', settings: {}, nodes: [] }
  const first = upsertCanvasNode(initial, { id: 'shot-1', kind: 'video', media: 'one.mp4', createdAt: 1 })
  const second = upsertCanvasNode(first, { id: 'shot-2', kind: 'video', media: 'two.mp4', createdAt: 2 })

  assert.deepEqual(second.nodes.map((node) => node.id), ['shot-1', 'shot-2'])
  assert.deepEqual(second.nodes.map((node) => node.order), [0, 1])
})

test('concurrent adapter upserts rebase after CAS conflict and retain both nodes', async () => {
  let current = createProjectAggregate({ id: 'project' })
  current.revision = 1
  current.legacyCanvas = { schemaVersion: 1, sessionId: 'session', settings: {}, nodes: [] }
  const projects = {
    resolveBinding: async () => ({ projectId: 'project' }),
    getProject: async () => structuredClone(current),
    execute: async ({ expectedRevision, payload }) => {
      await Promise.resolve()
      if (expectedRevision !== current.revision) {
        throw new DomainConflictError('revision conflict', { expectedRevision, actualRevision: current.revision })
      }
      current = { ...current, revision: current.revision + 1, legacyCanvas: structuredClone(payload.canvas) }
      return { project: structuredClone(current) }
    },
  }
  const adapter = new LegacyCanvasCommandAdapter(projects)

  await Promise.all([
    adapter.upsertNode('/workspace', 'session', { id: 'shot-1', kind: 'video', media: 'one.mp4', createdAt: 1 }),
    adapter.upsertNode('/workspace', 'session', { id: 'shot-2', kind: 'video', media: 'two.mp4', createdAt: 2 }),
  ])

  assert.deepEqual(current.legacyCanvas.nodes.map((node) => node.id), ['shot-1', 'shot-2'])
})

test('canvas adapter does not retry non-revision conflicts', async () => {
  const project = createProjectAggregate({ id: 'project' })
  project.legacyCanvas = { schemaVersion: 1, sessionId: 'session', settings: {}, nodes: [] }
  let calls = 0
  const adapter = new LegacyCanvasCommandAdapter({
    resolveBinding: async () => ({ projectId: 'project' }),
    getProject: async () => structuredClone(project),
    execute: async () => {
      calls += 1
      throw new DomainConflictError('command id reused with different payload')
    },
  })

  await assert.rejects(() => adapter.upsertNode('/workspace', 'session', { id: 'shot-1', kind: 'video' }), /command id reused/)
  assert.equal(calls, 1)
})

test('canvas read model recovers a missing legacy video under the stable shot id', () => {
  const project = createProjectAggregate({ id: 'project' })
  project.episodes.ep = { id: 'ep', order: 1, shotIds: ['shot-2'] }
  project.shots['shot-2'] = { id: 'shot-2', episodeId: 'ep', order: 1, title: '镜头二', shotDescription: '继续聚餐', approvedAssetId: 'video-2', assetIds: ['video-2'] }
  project.assets['video-2'] = { id: 'video-2', kind: 'video', status: 'approved', logicalKey: 'two.mp4', sourceIds: [], media: { actualDuration: 8 } }
  project.legacyCanvas = { schemaVersion: 1, sessionId: 'session', settings: {}, nodes: [] }

  const recovered = canvasReadModel(project).nodes.find((node) => node.id === 'shot-2')
  assert.equal(recovered.kind, 'video')
  assert.equal(recovered.media, 'two.mp4')
  assert.equal(recovered.params.shotId, 'shot-2')
})
