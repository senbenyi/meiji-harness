import * as path from 'node:path'
import { loadProjectFiles, projectGet, summaryOf } from './project.js'
import { validateShotUpdates } from './schema.js'
import { ToonflowError, ensureProjectExists, writeJsonAtomic } from './store.js'

export async function planGet(config, body = {}) {
  return projectGet(config, body)
}

export async function planUpdateShot(config, { projectId, shotId, updates } = {}) {
  if (typeof shotId !== 'string' || shotId.trim() === '') {
    throw new ToonflowError('VALIDATION_ERROR', 'shotId is required')
  }
  const dir = await ensureProjectExists(config, projectId)
  const data = await loadProjectFiles(dir)
  const index = data.shots.findIndex(shot => shot.id === shotId)
  if (index === -1) throw new ToonflowError('SHOT_NOT_FOUND', `Shot not found: ${shotId}`, 404)

  const now = new Date().toISOString()
  const shot = { ...data.shots[index], ...validateShotUpdates(updates), updatedAt: now }
  const shots = [...data.shots]
  shots[index] = shot
  const project = { ...data.project, updatedAt: now }
  await writeJsonAtomic(path.join(dir, 'shots.json'), shots)
  await writeJsonAtomic(path.join(dir, 'project.json'), project)
  return { ok: true, shot, project, summary: summaryOf({ ...data, project, shots }) }
}
