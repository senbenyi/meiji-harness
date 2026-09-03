import { ElysiumError } from './errors.js'

const SHOT_STATUSES = new Set([
  'draft',
  'prompt_ready',
  'image_queued',
  'image_ready',
  'video_queued',
  'video_ready',
  'failed',
])

function requiredText(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ElysiumError('VALIDATION_ERROR', `${field} is required`)
  }
  const text = value.trim()
  if (text.length > max) throw new ElysiumError('VALIDATION_ERROR', `${field} is too long`)
  return text
}

function optionalText(value, field, max) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new ElysiumError('VALIDATION_ERROR', `${field} must be a string`)
  if (value.length > max) throw new ElysiumError('VALIDATION_ERROR', `${field} is too long`)
  return value
}

export function validateProjectCreate(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ElysiumError('VALIDATION_ERROR', 'Request body must be an object')
  }
  return {
    title: requiredText(body.title, 'title', 120),
    description: optionalText(body.description, 'description', 2000)?.trim() || '',
  }
}

export function validateShotUpdates(updates) {
  if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new ElysiumError('VALIDATION_ERROR', 'updates must be an object')
  }
  const allowed = new Set([
    'description', 'camera', 'imagePrompt', 'videoPrompt', 'durationSec',
    'characterIds', 'sceneId', 'referenceImages', 'status',
  ])
  const result = {}
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.has(key)) throw new ElysiumError('VALIDATION_ERROR', `Shot field cannot be updated: ${key}`)
    if (['description', 'camera', 'imagePrompt', 'videoPrompt'].includes(key)) {
      result[key] = optionalText(value, key, 10000)
    } else if (key === 'durationSec') {
      if (!Number.isFinite(value) || value <= 0 || value > 300) {
        throw new ElysiumError('VALIDATION_ERROR', 'durationSec must be between 0 and 300')
      }
      result[key] = value
    } else if (key === 'characterIds' || key === 'referenceImages') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new ElysiumError('VALIDATION_ERROR', `${key} must be an array of strings`)
      }
      result[key] = [...value]
    } else if (key === 'sceneId') {
      if (value !== null && typeof value !== 'string') {
        throw new ElysiumError('VALIDATION_ERROR', 'sceneId must be a string or null')
      }
      result[key] = value
    } else if (key === 'status') {
      if (!SHOT_STATUSES.has(value)) throw new ElysiumError('VALIDATION_ERROR', 'Unknown shot status')
      result[key] = value
    }
  }
  if (Object.keys(result).length === 0) throw new ElysiumError('VALIDATION_ERROR', 'No shot updates supplied')
  return result
}
