// 职责：校验请求、保留付费提交记录、轮询原任务并持久化媒体。
import { mkdir, readFile, stat, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { bytePlusKey } from './config.js'
import { createClient } from './index.js'
import { projectJobRoot, projectRoot } from '../../../server/jobs/paths.js'
import { getJob } from '../../../server/jobs/query.js'
import { readJson, saveJson } from '../../../database/json.js'
import { openLocalMedia } from '../../../server/media/local-media.js'
import { withLaunchLock } from '../../../server/jobs/lock.js'
import { MODE_MEDIA, VIDEO_MODES, VIDEO_PROFILES } from '../../../server/workflows/videos/plan.js'
const invalid = message => { throw Object.assign(new Error(message), { status: 422, code: 'MODEL_INPUT_INVALID' }) }
const reference = value => typeof value === 'string' && (/^job:[a-f0-9]{32}$/.test(value) || /^asset:\/\/[^\s]+$/.test(value) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || (() => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false } })())
export function validatePlan(plan, backend) {
  if (!plan || typeof plan.prompt !== 'string' || !plan.prompt.trim()) invalid('请填写非空提示词')
  if (!VIDEO_MODES.includes(plan.mode) || plan.profile !== undefined && !VIDEO_PROFILES.includes(plan.profile)) invalid('视频模式或档次无效')
  const required = MODE_MEDIA[plan.mode]
  if (Object.keys(plan).some(key => !['prompt', 'mode', 'profile', 'duration_seconds', ...required].includes(key))) invalid('三方视频包含未支持参数')
  for (const key of required) if (!reference(plan[key])) invalid(`${key} 必须是图片素材 ID 或供应商可访问的图片引用`)
  const seconds = plan.duration_seconds ?? backend.connection.duration
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) invalid('Seedance 2.0 时长必须为4至15的整数秒')
  if (!['480p', '720p', '1080p'].includes(backend.connection.resolution)) invalid('视频 resolution 必须为480p、720p或1080p')
  if (!['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(backend.connection.ratio) || typeof backend.connection.generate_audio !== 'boolean') invalid('请配置视频 ratio 和 generate_audio')
}
async function imageReference(value) {
  if (!value.startsWith('job:')) return value
  const job = await getJob(value.slice(4))
  if (job.status !== 'succeeded' || job.result?.media_kind !== 'image') invalid('参考素材必须是已完成图片')
  const media = await openLocalMedia(job)
  try {
    if (media.size > 20 * 1024 * 1024) invalid('本地参考图片最多20 MB')
    return `data:${media.contentType};base64,${(await media.handle.readFile()).toString('base64')}`
  } finally { await media.handle.close() }
}
async function payload(plan, backend) {
  const roles = { first_frame: 'first_frame', last_frame: 'last_frame', reference_image_1: 'reference_image', reference_image_2: 'reference_image' }
  return { model: backend.connection.model, content: [{ type: 'text', text: plan.prompt }, ...await Promise.all(MODE_MEDIA[plan.mode].map(async key => ({ type: 'image_url', role: roles[key], image_url: { url: await imageReference(plan[key]) } })))],
    duration: plan.duration_seconds ?? backend.connection.duration, resolution: backend.connection.resolution, ratio: backend.connection.ratio,
    generate_audio: backend.connection.generate_audio, watermark: backend.connection.watermark ?? false }
}
async function registerMedia(projectId, jobId, path, kind) {
  const directory = join(projectRoot(projectId), 'media')
  await withLaunchLock(directory, async () => {
    const manifestPath = join(directory, 'manifest.json'), manifest = await readJson(manifestPath) || { version: 1, project_id: projectId, files: [], missing: [] }
    manifest.files = (manifest.files || []).filter(item => item.job_id !== jobId)
    manifest.files.push({ path, job_id: jobId, size_bytes: (await stat(join(projectRoot(projectId), path))).size })
    await saveJson(manifestPath, manifest)
  }, true)
  return { media_kind: kind, local_media_path: path }
}
export async function executeJob(projectId, jobId, plan, backend, { signal, sleep = pause } = {}) {
  validatePlan(plan, backend)
  bytePlusKey(backend)
  const directory = projectJobRoot(projectId, jobId), journalPath = join(directory, 'byteplus-submission.json')
  const statusPath = join(directory, 'status.json'), client = createClient(backend, { signal })
  const status = { job_id: jobId, project_id: projectId, capability: 'workflow-video', backend: 'byteplus', server: backend,
    status: 'running', stage: 'prepare', debug: { effective_input: plan }, created_at: new Date().toISOString() }
  await saveJson(statusPath, status)
  try {
    let journal = await readJson(journalPath)
    if (!journal) {
      const request = await payload(plan, backend)
      // 提交开始即落盘；未知 POST 结果禁止自动重发，避免重复计费。
      journal = { state: 'submitting', request_hash: createHash('sha256').update(JSON.stringify(request)).digest('hex') }
      await saveJson(journalPath, journal)
      status.stage = 'submit'; await saveJson(statusPath, status)
      const response = await client.request('contents/generations/tasks', request)
      journal = { ...journal, state: 'submitted', response }
      await saveJson(journalPath, journal)
    }
    if (journal.state === 'submitting') throw Object.assign(new Error('供应商提交结果未知；禁止重发。请核对供应商任务并将原响应补入 byteplus-submission.json 后恢复'), { code: 'BYTEPLUS_SUBMISSION_UNKNOWN' })
    let result = journal.response
    if (!result.id) throw new Error('供应商未返回任务 ID，禁止重发')
    status.remote_task_id = result.id; status.stage = 'poll'; await saveJson(statusPath, status)
    const deadline = Date.now() + 60 * 60 * 1000
    for (;;) {
      signal?.throwIfAborted()
      result = await client.request(`contents/generations/tasks/${encodeURIComponent(journal.response.id)}`)
      await saveJson(join(directory, 'byteplus-result.json'), result)
      if (result.status === 'succeeded') break
      if (['failed', 'cancelled', 'expired'].includes(result.status)) throw Object.assign(new Error(`原供应商任务${result.status}，恢复不会创建新任务`), { code: 'BYTEPLUS_TASK_FAILED' })
      if (Date.now() >= deadline) throw new Error('等待超时，请使用原任务 ID 恢复查询')
      await sleep(5000, undefined, { signal })
    }
    const url = result.content?.video_url
    if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('供应商缺少有效产物 URL')
    status.stage = 'download'; await saveJson(statusPath, status)
    const response = await fetch(url, { signal, redirect: 'error' })
    if (!response.ok) throw new Error(`产物下载失败：HTTP ${response.status}`)
    const path = `media/${jobId}.mp4`, file = join(projectRoot(projectId), path)
    await mkdir(join(projectRoot(projectId), 'media'), { recursive: true })
    const { pipeline } = await import('node:stream/promises'), { Readable } = await import('node:stream'), { createWriteStream } = await import('node:fs')
    try { await pipeline(Readable.fromWeb(response.body), createWriteStream(file + '.tmp', { mode: 0o600 })); await rename(file + '.tmp', file) }
    finally { await rm(file + '.tmp', { force: true }) }
    status.result = { ...await registerMedia(projectId, jobId, path, 'video'), provider: 'byteplus', model: backend.connection.model,
      profile: plan.profile, remote_task_id: journal.response.id, duration_sec: result.duration ?? plan.duration_seconds ?? backend.connection.duration,
      specification: { resolution: backend.connection.resolution, ratio: backend.connection.ratio, audio: backend.connection.generate_audio } }
    status.status = 'succeeded'; status.stage = 'completed'; status.finished_at = new Date().toISOString()
    await saveJson(statusPath, status)
    return status
  } catch (error) {
    status.status = 'failed'; status.failed_stage = status.stage; status.stage = 'failed'
    status.error_code = error.code || 'BYTEPLUS_GENERATION_FAILED'; status.error = error.message
    status.retry_scope = 'query-original-byteplus-task'; await saveJson(statusPath, status)
    throw error
  }
}
// 从本地生成视频提取参考帧，登记为图片任务供下一镜头复用。
export async function extractReference({ projectId, shotId, source, definition }) {
  const jobId = createHash('sha256').update(`${source.job_id}:${definition.id}:${definition.frame_index}`).digest('hex').slice(0, 32)
  const existing = await readJson(join(projectJobRoot(projectId, jobId), 'status.json'))
  if (existing?.status === 'succeeded') return { url: `job:${jobId}`, source_job_id: source.job_id, source_shot_id: shotId, frame_index: definition.frame_index }
  const job = await getJob(source.job_id), media = await openLocalMedia(job)
  await media.handle.close()
  const path = `media/${jobId}.png`
  const result = spawnSync('ffmpeg', ['-y', '-i', join(projectRoot(job.project_id), media.path), '-vf', `select=eq(n\\,${definition.frame_index})`, '-frames:v', '1', join(projectRoot(projectId), path)], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('本地参考帧提取失败；请检查 ffmpeg 和原视频')
  await saveJson(join(projectJobRoot(projectId, jobId), 'status.json'), { job_id: jobId, project_id: projectId, status: 'succeeded', capability: 'image-compose', result: await registerMedia(projectId, jobId, path, 'image') })
  return { url: `job:${jobId}`, source_job_id: source.job_id, source_shot_id: shotId, frame_index: definition.frame_index }
}
