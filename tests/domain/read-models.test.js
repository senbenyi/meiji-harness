import test from 'node:test'
import assert from 'node:assert/strict'
import { productionProgress } from '../../lib/domain/read-models.js'

test('asset progress counts only references required by the active media DAG', () => {
  const project = {
    sourceDocuments: { source: { contentHash: 'hash' } },
    episodes: {}, shots: {}, locations: {}, props: {}, assetVariants: {},
    characters: {
      used: { id: 'used', name: 'Used' },
      offscreen: { id: 'offscreen', name: 'Offscreen' },
      offscreen2: { id: 'offscreen2', name: 'Offscreen 2' },
    },
    productionTasks: {
      reference: { id: 'reference', runId: 'media', kind: 'render-reference', scopeId: 'used', status: 'pending', input: { preparationKind: 'character' } },
      render: { id: 'render', runId: 'media', kind: 'render-shot', scopeId: 'shot', status: 'pending', input: {} },
      unrelated: { id: 'unrelated', runId: 'rework', kind: 'render-reference', scopeId: 'offscreen', status: 'running', input: { preparationKind: 'character' } },
      unrelated2: { id: 'unrelated2', runId: 'rework', kind: 'render-reference', scopeId: 'offscreen2', status: 'running', input: { preparationKind: 'character' } },
    },
    productionRuns: {
      media: { id: 'media', mode: 'fast', createdAt: '2026-01-01T00:00:00.000Z', taskIds: ['reference', 'render'] },
      rework: { id: 'rework', mode: 'fast', createdAt: '2026-01-02T00:00:00.000Z', taskIds: ['unrelated', 'unrelated2'] },
    },
    developmentProposals: {}, deliverables: {}, timelines: {}, assets: {},
  }
  const assets = productionProgress(project).stages.find((stage) => stage.key === 'assets')
  assert.equal(assets.total, 1)
  assert.equal(assets.completed, 0)
})

test('asset progress keeps cached shot references even when no render-reference task is needed', () => {
  const project = {
    sourceDocuments: { source: { contentHash: 'hash' } },
    episodes: { episode: { id: 'episode', shotIds: ['shot'] } },
    shots: { shot: { id: 'shot', episodeId: 'episode', referenceBindings: [{ kind: 'character', entityId: 'used' }] } },
    locations: {}, props: {}, assetVariants: {},
    characters: {
      used: { id: 'used', name: 'Used' },
      offscreen: { id: 'offscreen', name: 'Offscreen' },
    },
    productionTasks: {
      render: { id: 'render', runId: 'media', kind: 'render-shot', scopeId: 'shot', status: 'pending', input: {} },
    },
    productionRuns: { media: { id: 'media', mode: 'fast', createdAt: '2026-01-01T00:00:00.000Z' } },
    developmentProposals: {}, deliverables: {}, timelines: {}, assets: {},
  }
  const assets = productionProgress(project).stages.find((stage) => stage.key === 'assets')
  assert.equal(assets.total, 1)
  assert.equal(assets.completed, 0)
})

test('a valid deliverable remains complete during unrelated asset rework', () => {
  const project = {
    status: 'active', sourceDocuments: { source: { contentHash: 'hash' } },
    episodes: {}, shots: {}, characters: {}, locations: {}, props: {}, assetVariants: {}, assets: {},
    productionTasks: {}, productionRuns: {}, developmentProposals: {},
    deliverables: { delivery: { id: 'delivery', status: 'ready', logicalKey: 'delivery.mp4', contentHash: 'hash', timelineId: 'timeline' } },
    timelines: { timeline: { assetIds: [] } },
  }
  const delivery = productionProgress(project).stages.find((stage) => stage.key === 'delivery')
  assert.equal(delivery.completed, 1)
  assert.equal(delivery.status, 'completed')
})
