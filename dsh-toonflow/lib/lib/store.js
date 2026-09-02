import * as path from 'node:path'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'

export class ToonflowError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ToonflowError'
    this.code = code
    this.status = status
  }
}

export function workspaceRoot(config = {}) {
  return path.resolve(String(config.workspace || './toonflow-workspace'))
}

export function projectsRoot(config = {}) {
  return path.join(workspaceRoot(config), 'projects')
}

export function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(projectId)) {
    throw new ToonflowError('INVALID_PROJECT_ID', 'projectId must contain only lowercase letters, numbers, and hyphens')
  }
  return projectId
}

export function projectDir(config, projectId) {
  return path.join(projectsRoot(config), assertProjectId(projectId))
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' && fallback !== undefined) return fallback
    if (error instanceof SyntaxError) {
      throw new ToonflowError('INVALID_JSON', `Invalid JSON file: ${path.basename(file)}`)
    }
    throw error
  }
}

export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

export async function ensureProjectExists(config, projectId) {
  const dir = projectDir(config, projectId)
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error('not a directory')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.message === 'not a directory') {
      throw new ToonflowError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`, 404)
    }
    throw error
  }
  return dir
}

export async function listProjectIds(config) {
  const root = projectsRoot(config)
  await mkdir(root, { recursive: true })
  return (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name))
    .map(entry => entry.name)
}

export async function removeProject(config, projectId) {
  const dir = await ensureProjectExists(config, projectId)
  await rm(dir, { recursive: true, force: false })
}

function ensureContained(root, candidate) {
  const relative = path.relative(root, candidate)
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new ToonflowError('INVALID_PATH', 'Path must stay inside the project directory')
  }
}

export async function resolveProjectFile(config, projectId, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
    throw new ToonflowError('INVALID_PATH', 'A relative project file path is required')
  }
  const dir = await ensureProjectExists(config, projectId)
  const candidate = path.resolve(dir, relativePath)
  ensureContained(dir, candidate)

  let resolved
  try {
    resolved = await realpath(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ToonflowError('FILE_NOT_FOUND', 'File not found', 404)
    throw error
  }
  ensureContained(await realpath(dir), resolved)
  if (!(await stat(resolved)).isFile()) throw new ToonflowError('INVALID_PATH', 'Path is not a file')
  return resolved
}
