import { randomUUID } from 'node:crypto'
import { DomainValidationError } from './errors.js'

export const PROJECT_SCHEMA_VERSION = 1
export const PROJECT_RECORD_LIMIT = 10 * 1024 * 1024

export const PROJECT_STATUSES = ['draft', 'active', 'blocked', 'completed', 'archived', 'cancelled']
export const EPISODE_STATUSES = ['draft', 'planning', 'assets', 'shotlist', 'storyboard', 'rendering', 'assembly', 'review', 'delivered', 'blocked', 'cancelled']
export const SHOT_STATUSES = ['planned', 'ready', 'generating', 'review', 'approved', 'assembled', 'rejected', 'invalidated', 'blocked']
export const ATTEMPT_STATUSES = ['created', 'submitting', 'submission_unknown', 'queued', 'running', 'downloading', 'completed', 'failed', 'cancelled']
export const ASSET_STATUSES = ['candidate', 'approved', 'rejected', 'invalidated', 'archived']
export const REVIEW_STATUSES = ['pending', 'automated_check', 'awaiting_human', 'approved', 'rejected', 'cancelled']
export const TIMELINE_STATUSES = ['draft', 'ready', 'invalidated', 'exported']
export const DELIVERABLE_STATUSES = ['planned', 'exporting', 'ready', 'delivered', 'failed', 'invalidated']

function now() {
  return new Date().toISOString()
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function createProjectAggregate(input = {}) {
  const timestamp = input.createdAt || now()
  const id = String(input.id || randomUUID())
  if (!id) throw new DomainValidationError('project id required')
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    revision: 0,
    status: 'draft',
    title: String(input.title || '未命名短剧项目'),
    createdAt: timestamp,
    updatedAt: timestamp,
    productionSpec: {
      contentRating: '',
      targetDuration: 0,
      episodeCount: 0,
      aspectRatio: '16:9',
      deliveryQuality: 'balanced',
      audioStrategy: 'native',
      prohibitions: [],
      ...(input.productionSpec || {}),
    },
    storyBible: null,
    characters: {},
    characterStates: {},
    locations: {},
    episodes: {},
    shots: {},
    attempts: {},
    assets: {},
    reviewTasks: {},
    reviewDecisions: {},
    timelines: {},
    deliverables: {},
    rightsRecords: {},
    outboxEvents: {},
    commandResults: {},
    runtimeHealth: {},
    legacyCanvas: null,
  }
}

export function parseProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainValidationError('project record must be an object')
  }
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new DomainValidationError(`unsupported project schemaVersion: ${value.schemaVersion}`)
  }
  if (!value.id || typeof value.id !== 'string') throw new DomainValidationError('project.id required')
  if (!Number.isInteger(value.revision) || value.revision < 0) throw new DomainValidationError('project.revision must be a non-negative integer')
  if (!PROJECT_STATUSES.includes(value.status)) throw new DomainValidationError(`invalid project status: ${value.status}`)
  const normalized = {
    ...value,
    productionSpec: record(value.productionSpec),
    characters: record(value.characters),
    characterStates: record(value.characterStates),
    locations: record(value.locations),
    episodes: record(value.episodes),
    shots: record(value.shots),
    attempts: record(value.attempts),
    assets: record(value.assets),
    reviewTasks: record(value.reviewTasks),
    reviewDecisions: record(value.reviewDecisions),
    timelines: record(value.timelines),
    deliverables: record(value.deliverables),
    rightsRecords: record(value.rightsRecords),
    outboxEvents: record(value.outboxEvents),
    commandResults: record(value.commandResults),
    runtimeHealth: record(value.runtimeHealth),
  }
  const bytes = Buffer.byteLength(JSON.stringify(normalized))
  if (bytes > PROJECT_RECORD_LIMIT) throw new DomainValidationError(`project record exceeds ${PROJECT_RECORD_LIMIT} bytes`, { bytes })
  return normalized
}

export const projectRecordSchema = {
  parse: parseProject,
  safeParse(value) {
    try { return { success: true, data: parseProject(value) } } catch (error) { return { success: false, error } }
  },
}

export const bindingRecordSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || !value.projectId || !value.bindingKey) {
      throw new DomainValidationError('invalid project binding')
    }
    return value
  },
  safeParse(value) {
    try { return { success: true, data: this.parse(value) } } catch (error) { return { success: false, error } }
  },
}

export const studioDomainSpec = {
  name: 'short_video_studio',
  version: 1,
  layout: 'per-record',
  tables: {
    projects: { valueSchema: projectRecordSchema },
    bindings: { valueSchema: bindingRecordSchema },
  },
}
