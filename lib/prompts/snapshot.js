import { createHash } from 'node:crypto'
import { DomainValidationError } from '../domain/errors.js'

export const PROMPT_SNAPSHOT_SCHEMA_VERSION = 1
export const PROMPT_SNAPSHOT_LIMIT = 64 * 1024

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizedInput(input) {
  if (input.references !== undefined && !Array.isArray(input.references)) throw new DomainValidationError('prompt snapshot references must be an array')
  if (input.parameters !== undefined && (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters))) {
    throw new DomainValidationError('prompt snapshot parameters must be an object')
  }
  return {
    schemaVersion: PROMPT_SNAPSHOT_SCHEMA_VERSION,
    projectRevision: Number(input.projectRevision),
    shotId: String(input.shotId || ''),
    prompt: String(input.prompt || ''),
    negativePrompt: String(input.negativePrompt || ''),
    references: structuredClone(input.references || []),
    parameters: structuredClone(input.parameters || {}),
    capabilityKey: String(input.capabilityKey || ''),
    workflowFingerprint: String(input.workflowFingerprint || ''),
  }
}

export function createPromptSnapshot(input) {
  const snapshot = normalizedInput(input)
  if (!Number.isInteger(snapshot.projectRevision) || snapshot.projectRevision < 0) throw new DomainValidationError('prompt snapshot projectRevision must be a non-negative integer')
  if (!snapshot.shotId) throw new DomainValidationError('prompt snapshot shotId required')
  if (!snapshot.capabilityKey) throw new DomainValidationError('prompt snapshot capabilityKey required')
  const encoded = canonical(snapshot)
  const bytes = Buffer.byteLength(encoded)
  if (bytes > PROMPT_SNAPSHOT_LIMIT) throw new DomainValidationError(`prompt snapshot exceeds ${PROMPT_SNAPSHOT_LIMIT} bytes`, { bytes })
  return { ...snapshot, snapshotHash: createHash('sha256').update(encoded).digest('hex') }
}

export function validatePromptSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainValidationError('prompt snapshot must be an object')
  const normalized = createPromptSnapshot(value)
  if (value.snapshotHash !== normalized.snapshotHash) throw new DomainValidationError('prompt snapshot hash mismatch')
  return normalized
}
