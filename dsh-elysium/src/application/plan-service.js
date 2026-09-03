import { projectGet } from './project-service.js'
import { validateShotUpdates } from '../domain/project.js'
import { ElysiumError } from '../infrastructure/persistence/store.js'
import { updateShotRecord } from './shot-service.js'

export async function planGet(config, body = {}) {
  return projectGet(config, body)
}

export async function planUpdateShot(config, { projectId, shotId, updates } = {}) {
  if (typeof shotId !== 'string' || shotId.trim() === '') {
    throw new ElysiumError('VALIDATION_ERROR', 'shotId is required')
  }
  const validated = validateShotUpdates(updates)
  return updateShotRecord(config, projectId, shotId, shot => ({ ...shot, ...validated }))
}
