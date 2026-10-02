import { homedir } from 'node:os'
import { join } from 'node:path'

export const STORAGE_LAYOUT_VERSION = 2
export const STUDIO_STORAGE_ROOT = join(homedir(), '.dsh', 'storages', 'short_video_studio')

export const PROJECT_STEPS = Object.freeze({
  metadata: 'step-00-project',
  source: 'step-01-source',
  development: 'step-02-development',
  episodePlan: 'step-03-episode-plan',
  scripts: 'step-04-scripts',
  assets: 'step-05-assets',
  storyboards: 'step-06-storyboards',
  generation: 'step-07-generation',
  assembly: 'step-08-assembly',
  qualityReview: 'step-09-quality-review',
  delivery: 'step-10-delivery',
})

export function storageLayout(root) {
  return {
    root,
    projects: join(root, 'projects'),
    tmp: join(root, 'tmp'),
    trash: join(root, 'trash'),
    leases: join(root, 'leases'),
    audit: join(root, 'audit.ndjson'),
  }
}

export function projectDirectory(root, projectId) {
  assertStorageId(projectId, 'projectId')
  return join(root, 'projects', String(projectId))
}

export function projectDirectories(root, projectId) {
  const project = projectDirectory(root, projectId)
  return {
    project,
    ...Object.fromEntries(Object.entries(PROJECT_STEPS).map(([name, step]) => [name, join(project, step)])),
    cache: join(project, 'cache'),
    tmp: join(project, 'tmp'),
    trash: join(project, 'trash'),
  }
}

export function formatProjectId(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('project timestamp is invalid')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}${String(date.getMilliseconds()).padStart(3, '0')}`
}

export function safeName(value, fallback = 'untitled') {
  const normalized = String(value || '').normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

function assertStorageId(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value))) {
    throw new Error(`${label} must be a safe storage identifier`)
  }
}

function projectKey(projectId, step, filename) {
  assertStorageId(projectId, 'projectId')
  return `projects/${projectId}/${step}/${filename}`
}

export function sourceDocumentLogicalKey(projectId, sourceId, title = 'source') {
  if (![projectId, sourceId].every((value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value)))) {
    throw new Error('projectId and sourceId must be safe storage identifiers')
  }
  return projectKey(projectId, PROJECT_STEPS.source, `step-01-${sourceId}-${safeName(title, 'source')}.txt`)
}

export function assetLogicalKey(projectId, assetId, extension = 'bin') {
  assertStorageId(assetId, 'assetId')
  const ext = String(extension).replace(/^\./, '')
  return projectKey(projectId, PROJECT_STEPS.generation, `step-07-${safeName(assetId, 'asset')}.${ext}`)
}

export function deliverableLogicalKey(projectId, deliverableId, extension = 'mp4') {
  assertStorageId(deliverableId, 'deliverableId')
  const ext = String(extension).replace(/^\./, '')
  return projectKey(projectId, PROJECT_STEPS.delivery, `step-10-${safeName(deliverableId, 'deliverable')}.${ext}`)
}
