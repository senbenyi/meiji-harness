// 职责：任务媒体的唯一存储入口：保存并登记产物，校验登记后只打开存储根内的受支持文件。
import { uploadsRoot } from '../../database/paths.js'
import { readJson, saveJson } from '../../database/json.js'
import { constants, createWriteStream } from 'node:fs'
import { mkdir, open, realpath, readFile, rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extname, join, relative, sep } from 'node:path'
import { projectRoot, validProjectId, validJobId } from './paths.js'
import { withLaunchLock } from './lock.js'

const formats = { '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.webp': ['image', 'image/webp'], '.mp4': ['video', 'video/mp4'], '.srt': ['file', 'application/x-subrip; charset=utf-8'] }
const failure = (status, message) => Object.assign(new Error(message), { status })
const inside = (root, path) => { const name = relative(root, path); return name && name !== '..' && !name.startsWith(`..${sep}`) && !name.startsWith(sep) }

export function localMediaValue(result) {
  const path = result?.local_media_path
  if (typeof path !== 'string' || !/^media\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw failure(403, '本地媒体路径无效')
  const format = formats[extname(path).toLowerCase()]
  if (!format || result.media_kind !== format[0]) throw failure(403, '本地媒体类型无效')
  return { path, kind: format[0], contentType: format[1] }
}

export async function openLocalMedia(job) {
  const uploaded = job.backend === 'upload' && validJobId(job.job_id)
  if (!uploaded && !validProjectId(job.project_id)) throw failure(403, '本地媒体缺少项目归属')
  const value = localMediaValue(job.result), root = await realpath(uploaded ? join(uploadsRoot(), job.job_id) : projectRoot(job.project_id))
  try {
    const manifestPath = await realpath(join(root, 'media', 'manifest.json'))
    if (!inside(root, manifestPath)) throw failure(403, '本地媒体登记越界')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const record = manifest.files?.find(item => item.path === value.path && item.job_id === job.job_id)
    if (!record && manifest.missing?.some(item => item.path === value.path && item.job_id === job.job_id)) throw failure(404, '本地参考图缺失；未生成替代图片')
    if (!record) throw failure(403, '本地媒体未登记')
    const path = await realpath(join(root, value.path))
    if (!inside(root, path)) throw failure(403, '本地媒体路径越界')
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw failure(403, '本地媒体不是普通文件')
      if (stat.size !== record.size_bytes) throw failure(409, '本地媒体大小与登记不符')
      return { ...value, handle, size: stat.size, etag: `"${stat.size}-${stat.mtimeMs}"` }
    } catch (error) { await handle.close(); throw error }
  } catch (error) {
    if (error.code === 'ENOENT') throw failure(404, '本地媒体文件或登记缺失，请重新安装完整模板')
    throw error
  }
}

// 在项目媒体清单中登记产物；同一任务重复登记时替换旧记录。
export async function registerMedia(projectId, jobId, path, kind) {
  const directory = join(projectRoot(projectId), 'media')
  await withLaunchLock(directory, async () => {
    const manifestPath = join(directory, 'manifest.json'), manifest = await readJson(manifestPath) || { version: 1, project_id: projectId, files: [], missing: [] }
    manifest.files = (manifest.files || []).filter(item => item.job_id !== jobId)
    manifest.files.push({ path, job_id: jobId, size_bytes: (await stat(join(projectRoot(projectId), path))).size })
    await saveJson(manifestPath, manifest)
  }, true)
  return { media_kind: kind, local_media_path: path }
}

// 将下载流原子写入 media/<jobId><extension> 并登记。
export async function saveMedia(projectId, jobId, body, { extension, kind }) {
  const path = `media/${jobId}${extension}`, file = join(projectRoot(projectId), path)
  await mkdir(join(projectRoot(projectId), 'media'), { recursive: true })
  try { await pipeline(Readable.fromWeb(body), createWriteStream(file + '.tmp', { mode: 0o600 })); await rename(file + '.tmp', file) }
  finally { await rm(file + '.tmp', { force: true }) }
  return registerMedia(projectId, jobId, path, kind)
}
