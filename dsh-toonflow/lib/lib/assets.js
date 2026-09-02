import * as path from 'node:path'
import { copyFile, mkdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { ToonflowError, ensureProjectExists } from './store.js'

const EXTENSIONS = {
  image: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']),
  video: new Set(['.mp4', '.webm', '.mov']),
}

function safeName(value, field) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new ToonflowError('INVALID_ASSET_ID', `${field} contains unsupported characters`)
  }
  return value
}

export async function registerGeneratedAsset(config, {
  projectId,
  scope,
  entityId,
  kind,
  outputPath,
}) {
  if (!['characters', 'shots'].includes(scope)) {
    throw new ToonflowError('INVALID_ASSET_SCOPE', 'Asset scope must be characters or shots')
  }
  const allowed = EXTENSIONS[kind]
  if (!allowed) throw new ToonflowError('INVALID_ASSET_KIND', 'Asset kind must be image or video')
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw new ToonflowError('INVALID_OUTPUT', 'ComfyUI output must be an absolute file path')
  }

  let source
  try {
    source = await realpath(outputPath)
    if (!(await stat(source)).isFile()) throw new Error('not a file')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.message === 'not a file') {
      throw new ToonflowError('OUTPUT_NOT_FOUND', 'ComfyUI output file does not exist', 502)
    }
    throw error
  }

  const extension = path.extname(source).toLowerCase()
  if (!allowed.has(extension)) {
    throw new ToonflowError('UNSUPPORTED_OUTPUT', `Unsupported ${kind} output: ${extension || '(no extension)'}`, 502)
  }

  const project = await ensureProjectExists(config, projectId)
  const directory = path.join(project, 'assets', scope)
  await mkdir(directory, { recursive: true })
  const filename = `${safeName(entityId, 'entityId')}-${kind}-${Date.now()}${extension}`
  const destination = path.join(directory, filename)
  const temp = path.join(directory, `.${filename}.${process.pid}.tmp`)
  try {
    await copyFile(source, temp)
    await rename(temp, destination)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  return path.posix.join('assets', scope, filename)
}
