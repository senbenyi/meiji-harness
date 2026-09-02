import * as path from 'node:path'
import { loadProjectFiles, summaryOf } from './project.js'
import { ToonflowError, ensureProjectExists, writeJsonAtomic } from './store.js'

const projectLocks = new Map()

async function withProjectLock(config, projectId, task) {
  const directory = await ensureProjectExists(config, projectId)
  const key = path.resolve(directory)
  const previous = projectLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  projectLocks.set(key, previous.then(() => current))
  await previous
  try {
    return await task(directory)
  } finally {
    release()
    if (projectLocks.get(key) === current) projectLocks.delete(key)
  }
}

function resultOf(data, extra = {}) {
  return { ok: true, ...data, summary: summaryOf(data), ...extra }
}

export async function updateShotRecord(config, projectId, shotId, updater) {
  return withProjectLock(config, projectId, async directory => {
    const data = await loadProjectFiles(directory)
    const index = data.shots.findIndex(shot => shot.id === shotId)
    if (index === -1) throw new ToonflowError('SHOT_NOT_FOUND', `Shot not found: ${shotId}`, 404)
    const now = new Date().toISOString()
    const shot = { ...await updater({ ...data.shots[index] }, data), updatedAt: now }
    const shots = [...data.shots]
    shots[index] = shot
    const project = { ...data.project, updatedAt: now }
    await writeJsonAtomic(path.join(directory, 'shots.json'), shots)
    await writeJsonAtomic(path.join(directory, 'project.json'), project)
    return resultOf({ ...data, project, shots }, { shot })
  })
}

export async function updateCharacterRecord(config, projectId, characterId, updater) {
  return withProjectLock(config, projectId, async directory => {
    const data = await loadProjectFiles(directory)
    const index = data.characters.findIndex(character => character.id === characterId)
    if (index === -1) throw new ToonflowError('CHARACTER_NOT_FOUND', `Character not found: ${characterId}`, 404)
    const now = new Date().toISOString()
    const character = { ...await updater({ ...data.characters[index] }, data), updatedAt: now }
    const characters = [...data.characters]
    characters[index] = character
    const project = { ...data.project, updatedAt: now }
    await writeJsonAtomic(path.join(directory, 'characters.json'), characters)
    await writeJsonAtomic(path.join(directory, 'project.json'), project)
    return resultOf({ ...data, project, characters }, { character })
  })
}
