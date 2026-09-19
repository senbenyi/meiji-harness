// 职责：从已完成视频任务提取并缓存第一帧，供项目列表封面使用。
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { findJobRoot, projectRoot } from '../jobs/paths.js'
import { uploadsRoot } from '../../database/paths.js'
import { openLocalMedia } from './local-media.js'

const failure = (status, message) => Object.assign(new Error(message), { status })

async function openPng(path) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || !info.size) throw failure(404, '媒体尚不可用')
    return { handle, size: info.size, contentType: 'image/png', etag: `"${info.size}-${info.mtimeMs}"` }
  } catch (error) { await handle.close(); throw error }
}

async function sourcePath(job) {
  if (job.result?.local_media_path) {
    const media = await openLocalMedia(job)
    const root = job.backend === 'upload' ? join(uploadsRoot(), job.job_id) : projectRoot(job.project_id)
    await media.handle.close()
    return join(root, media.path)
  }
  const url = job.result?.comfyui_view_url
  if (typeof url === 'string' && /^https?:\/\//.test(url) && !new URL(url).username && !new URL(url).password) return url
  throw failure(404, '媒体尚不可用')
}

export async function openFirstFrame(job) {
  const found = await findJobRoot(job.job_id)
  if (!found) throw failure(404, '媒体尚不可用')
  const path = join(found.directory, 'first-frame.png')
  try { return await openPng(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const input = await sourcePath(job)
  const temporary = join(found.directory, `${randomUUID()}.png`)
  try {
    const result = spawnSync('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-ss', '0', '-i', input, '-frames:v', '1', '-an', temporary], { encoding: 'utf8', timeout: 20000 })
    if (result.status !== 0) throw failure(502, '视频封面提取失败')
    if (!(await stat(temporary)).size) throw failure(502, '视频封面提取失败')
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
  return openPng(path)
}
