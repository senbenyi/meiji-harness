import { projectGet } from './project.js'
import { validateShotUpdates } from './schema.js'
import { ElysiumError } from './store.js'
import { updateShotRecord } from './shot.js'

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
