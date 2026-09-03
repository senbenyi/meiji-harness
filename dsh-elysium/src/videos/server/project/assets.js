import * as path from 'node:path'
import { copyFile, mkdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { ElysiumError, ensureProjectExists } from '../infrastructure/store.js'

const EXTENSIONS = {
  image: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']),
  video: new Set(['.mp4', '.webm', '.mov']),
}

const IMAGE_SIGNATURES = {
  '.png': buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  '.jpg': buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  '.jpeg': buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  '.gif': buffer => buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
  '.webp': buffer => buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
}

function safeName(value, field) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new ElysiumError('INVALID_ASSET_ID', `${field} contains unsupported characters`)
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
    throw new ElysiumError('INVALID_ASSET_SCOPE', 'Asset scope must be characters or shots')
  }
  const allowed = EXTENSIONS[kind]
  if (!allowed) throw new ElysiumError('INVALID_ASSET_KIND', 'Asset kind must be image or video')
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw new ElysiumError('INVALID_OUTPUT', 'ComfyUI output must be an absolute file path')
  }

  let source
  try {
    source = await realpath(outputPath)
    if (!(await stat(source)).isFile()) throw new Error('not a file')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.message === 'not a file') {
      throw new ElysiumError('OUTPUT_NOT_FOUND', 'ComfyUI output file does not exist', 502)
    }
    throw error
  }

  const extension = path.extname(source).toLowerCase()
  if (!allowed.has(extension)) {
    throw new ElysiumError('UNSUPPORTED_OUTPUT', `Unsupported ${kind} output: ${extension || '(no extension)'}`, 502)
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

export async function registerUploadedImage(config, {
  projectId,
  scope,
  entityId,
  filename: sourceName,
  bytes,
}) {
  if (!['characters', 'shots'].includes(scope)) {
    throw new ElysiumError('INVALID_ASSET_SCOPE', 'Asset scope must be characters or shots')
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new ElysiumError('EMPTY_UPLOAD', 'Select a non-empty image file')
  }
  const extension = path.extname(String(sourceName || '')).toLowerCase()
  const matches = IMAGE_SIGNATURES[extension]
  if (!matches || !matches(bytes)) {
    throw new ElysiumError('UNSUPPORTED_IMAGE', 'Only valid PNG, JPEG, GIF, or WebP images are supported', 415)
  }

  const project = await ensureProjectExists(config, projectId)
  const directory = path.join(project, 'assets', scope)
  await mkdir(directory, { recursive: true })
  const filename = `${safeName(entityId, 'entityId')}-image-${Date.now()}${extension}`
  const destination = path.join(directory, filename)
  const temp = path.join(directory, `.${filename}.${process.pid}.tmp`)
  try {
    await writeFile(temp, bytes, { flag: 'wx' })
    await rename(temp, destination)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  return path.posix.join('assets', scope, filename)
}
