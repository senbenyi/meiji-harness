import { createHash } from 'node:crypto'
import { DomainValidationError } from '../domain/errors.js'

export const PROMPT_SNAPSHOT_SCHEMA_VERSION = 2
export const PROMPT_SNAPSHOT_LIMIT = 64 * 1024

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizedInput(input, schemaVersion = PROMPT_SNAPSHOT_SCHEMA_VERSION) {
  if (input.references !== undefined && !Array.isArray(input.references)) throw new DomainValidationError('prompt snapshot references must be an array')
  if (input.parameters !== undefined && (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters))) {
    throw new DomainValidationError('prompt snapshot parameters must be an object')
  }
  return {
    schemaVersion,
    projectRevision: Number(input.projectRevision),
    shotId: String(input.shotId || ''),
    prompt: String(input.prompt || ''),
    negativePrompt: String(input.negativePrompt || ''),
    references: structuredClone(input.references || []),
    parameters: structuredClone(input.parameters || {}),
    capabilityKey: String(input.capabilityKey || ''),
    workflowFingerprint: String(input.workflowFingerprint || ''),
    ...(input.target ? { target: structuredClone(input.target) } : {}),
  }
}

function validateNormalized(snapshot) {
  if (![1, PROMPT_SNAPSHOT_SCHEMA_VERSION].includes(snapshot.schemaVersion)) throw new DomainValidationError(`unsupported prompt snapshot schemaVersion: ${snapshot.schemaVersion}`)
  if (!Number.isInteger(snapshot.projectRevision) || snapshot.projectRevision < 0) throw new DomainValidationError('prompt snapshot projectRevision must be a non-negative integer')
  if (!snapshot.shotId) throw new DomainValidationError('prompt snapshot shotId required')
  if (!snapshot.capabilityKey) throw new DomainValidationError('prompt snapshot capabilityKey required')
}

function encodedIdentity(snapshot) {
  if (snapshot.schemaVersion === 1) return canonical(snapshot)
  const { projectRevision: _projectRevision, ...identity } = snapshot
  return canonical(identity)
}

function withHash(snapshot) {
  validateNormalized(snapshot)
  const encoded = canonical(snapshot)
  const bytes = Buffer.byteLength(encoded)
  if (bytes > PROMPT_SNAPSHOT_LIMIT) throw new DomainValidationError(`prompt snapshot exceeds ${PROMPT_SNAPSHOT_LIMIT} bytes`, { bytes })
  return { ...snapshot, snapshotHash: createHash('sha256').update(encodedIdentity(snapshot)).digest('hex') }
}

export function createPromptSnapshot(input) {
  const snapshot = normalizedInput(input)
  return withHash(snapshot)
}

export function validatePromptSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainValidationError('prompt snapshot must be an object')
  const schemaVersion = Number(value.schemaVersion ?? PROMPT_SNAPSHOT_SCHEMA_VERSION)
  const normalized = withHash(normalizedInput(value, schemaVersion))
  if (value.snapshotHash !== normalized.snapshotHash) throw new DomainValidationError('prompt snapshot hash mismatch')
  return normalized
}
