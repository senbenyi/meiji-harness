import { join } from 'node:path'

export const STORAGE_LAYOUT_VERSION = 1

export function storageLayout(root) {
  return {
    root,
    media: join(root, 'media'),
    source: join(root, 'source'),
    exports: join(root, 'exports'),
    cache: join(root, 'cache'),
    tmp: join(root, 'tmp'),
    trash: join(root, 'trash'),
    leases: join(root, 'leases'),
    audit: join(root, 'audit.ndjson'),
  }
}

export function assetLogicalKey(projectId, assetId, extension = 'bin') {
  return `media/${projectId}/${assetId}.${String(extension).replace(/^\./, '')}`
}

export function sourceDocumentLogicalKey(projectId, sourceId) {
  if (![projectId, sourceId].every((value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value)))) {
    throw new Error('projectId and sourceId must be safe storage identifiers')
  }
  return `source/${projectId}/${sourceId}.txt`
}

export function deliverableLogicalKey(projectId, deliverableId, extension = 'mp4') {
  return `exports/${projectId}/${deliverableId}.${String(extension).replace(/^\./, '')}`
}
