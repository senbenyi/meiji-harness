// 职责：为已校验的本地媒体生成可复用的轻量预览，原件由下载入口读取。
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { runtimeRoot } from '../../database/paths.js'
import { closeFile, constants, createWriteStream, managedFile, mkdir, open, rename, rm, statOpenedFile } from '../../database/files.js'

const pending = new Map()

async function generate(source, target, kind) {
  const temporary = `${target}.${randomBytes(4).toString('hex')}.tmp`
  const image = kind === 'image'
  const args = ['-hide_banner', '-loglevel', 'error', '-i', source, '-map', '0:v:0',
    '-vf', 'scale=ceil(iw/4)*2:ceil(ih/4)*2', ...(image
      ? ['-an', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '65', '-f', 'webp']
      : ['-map', '0:a?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '34', '-c:a', 'aac', '-b:a', '48k',
        '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4']), 'pipe:1']
  const process = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(30_000) })
  let diagnostics = ''
  process.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-1000) })
  const finished = new Promise((resolve, reject) => {
    process.once('error', reject)
    process.once('close', code => code === 0 ? resolve() : reject(new Error(`预览转换失败: ${diagnostics || code}`)))
  })
  try {
    await Promise.all([pipeline(process.stdout, createWriteStream(temporary, { mode: 0o600 })), finished])
    await rename(temporary, target)
  } catch (error) {
    process.kill()
    await finished.catch(() => {})
    throw error
  } finally { await rm(temporary, { force: true }) }
}

async function openPreview(job, input, kind, version) {
  const directory = join(runtimeRoot(), 'previews')
  const key = createHash('sha256').update(`${job.job_id}:${version}`).digest('hex').slice(0, 24)
  const target = join(directory, `${job.job_id}-${key}.${kind === 'image' ? 'webp' : 'mp4'}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let handle
  try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!pending.has(target)) pending.set(target, generate(input, target, kind).finally(() => pending.delete(target)))
    await pending.get(target)
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  }
  const info = await statOpenedFile(handle)
  return { handle: managedFile(handle), size: info.size, etag: `"${key}-${info.size}"`,
    contentType: kind === 'image' ? 'image/webp' : 'video/mp4' }
}

export const openLocalPreview = (job, source) => source.size < 256 ? source : openPreview(job, source.absolutePath, source.kind, source.etag)
export const openRemotePreview = (job, url) => openPreview(job, url, 'video', url)
