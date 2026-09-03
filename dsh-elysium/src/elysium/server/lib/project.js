import * as path from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
  ElysiumError,
  ensureProjectExists,
  listProjectIds,
  projectDir,
  projectsRoot,
  readJson,
  removeProject,
  writeJsonAtomic,
} from './store.js'
import { validateProjectCreate } from './schema.js'

function entityFile(dir, name) {
  return path.join(dir, `${name}.json`)
}

function makeProjectId() {
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function loadProjectFiles(dir) {
  const [project, characters, scenes, shots] = await Promise.all([
    readJson(entityFile(dir, 'project')),
    readJson(entityFile(dir, 'characters'), []),
    readJson(entityFile(dir, 'scenes'), []),
    readJson(entityFile(dir, 'shots'), []),
  ])
  if (!Array.isArray(characters) || !Array.isArray(scenes) || !Array.isArray(shots)) {
    throw new ElysiumError('INVALID_PROJECT_DATA', `Project data must use arrays: ${project.id || dir}`)
  }
  return { project, characters, scenes, shots }
}

export function summaryOf(data) {
  const shotsDone = data.shots.filter(shot => shot.status === 'video_ready').length
  return {
    ...data.project,
    characterCount: data.characters.length,
    sceneCount: data.scenes.length,
    shotsTotal: data.shots.length,
    shotsDone,
  }
}

export async function projectList(config) {
  const projects = []
  for (const projectId of await listProjectIds(config)) {
    const dir = projectDir(config, projectId)
    try {
      projects.push(summaryOf(await loadProjectFiles(dir)))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return { ok: true, projects }
}

export async function projectGet(config, { projectId } = {}) {
  const dir = await ensureProjectExists(config, projectId)
  const data = await loadProjectFiles(dir)
  return { ok: true, ...data, summary: summaryOf(data) }
}

export async function projectCreate(config, body = {}) {
  const input = validateProjectCreate(body)
  await mkdir(projectsRoot(config), { recursive: true })

  let id
  let dir
  for (let attempt = 0; attempt < 5; attempt += 1) {
    id = makeProjectId()
    dir = projectDir(config, id)
    try {
      await mkdir(dir)
      break
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt === 4) throw error
    }
  }

  const now = new Date().toISOString()
  const project = { id, title: input.title, description: input.description, createdAt: now, updatedAt: now }
  try {
    await Promise.all([
      mkdir(path.join(dir, 'assets', 'characters'), { recursive: true }),
      mkdir(path.join(dir, 'assets', 'scenes'), { recursive: true }),
      mkdir(path.join(dir, 'assets', 'shots'), { recursive: true }),
      mkdir(path.join(dir, 'output'), { recursive: true }),
    ])
    await Promise.all([
      writeJsonAtomic(entityFile(dir, 'project'), project),
      writeJsonAtomic(entityFile(dir, 'characters'), []),
      writeJsonAtomic(entityFile(dir, 'scenes'), []),
      writeJsonAtomic(entityFile(dir, 'shots'), []),
    ])
  } catch (error) {
    await removeProject(config, id).catch(() => {})
    throw error
  }
  return { ok: true, project, summary: summaryOf({ project, characters: [], scenes: [], shots: [] }) }
}

export async function projectDelete(config, { projectId } = {}) {
  await removeProject(config, projectId)
  return { ok: true, projectId }
}
