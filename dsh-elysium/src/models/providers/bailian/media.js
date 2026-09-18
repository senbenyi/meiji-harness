// 职责：登记百炼下载媒体，并提取本地视频参考帧供下一镜头复用。
import { stat, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { projectJobRoot, projectRoot } from '../../../server/jobs/paths.js'
import { getJob } from '../../../server/jobs/query.js'
import { readJson, saveJson } from '../../../database/json.js'
import { openLocalMedia } from '../../../server/media/local-media.js'
import { withLaunchLock } from '../../../server/jobs/lock.js'

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
export async function imageReference(value) {
  if (!value.startsWith('job:')) return value
  const job = await getJob(value.slice(4))
  if (job.status !== 'succeeded' || job.result?.media_kind !== 'image') throw new Error('参考素材必须是已完成图片')
  const media = await openLocalMedia(job)
  try {
    if (media.size > 20 * 1024 * 1024) throw new Error('本地参考图片最多20 MB')
    return `data:${media.contentType};base64,${(await media.handle.readFile()).toString('base64')}`
  } finally { await media.handle.close() }
}
export async function extractReference({ projectId, shotId, source, definition }) {
  if (!Number.isSafeInteger(definition.frame_index) || definition.frame_index < 0) throw new Error('参考帧序号必须是非负整数')
  const jobId = createHash('sha256').update(`${source.job_id}:${definition.id}:${definition.frame_index}`).digest('hex').slice(0, 32)
  const reference = { url: `job:${jobId}`, source_job_id: source.job_id, source_shot_id: shotId, frame_index: definition.frame_index }
  const existing = await readJson(join(projectJobRoot(projectId, jobId), 'status.json'))
  if (existing?.status === 'succeeded') return reference
  const job = await getJob(source.job_id), media = await openLocalMedia(job)
  await media.handle.close()
  const path = `media/${jobId}.png`
  await mkdir(join(projectRoot(projectId), 'media'), { recursive: true })
  const result = spawnSync('ffmpeg', ['-y', '-i', join(projectRoot(job.project_id), media.path), '-vf', `select=eq(n\\,${definition.frame_index})`, '-frames:v', '1', join(projectRoot(projectId), path)], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('本地参考帧提取失败；请检查 ffmpeg 和原视频')
  await saveJson(join(projectJobRoot(projectId, jobId), 'status.json'), { job_id: jobId, project_id: projectId, status: 'succeeded', capability: 'image-compose', result: await registerMedia(projectId, jobId, path, 'image') })
  return reference
}
