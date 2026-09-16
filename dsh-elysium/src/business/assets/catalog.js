// 职责：从本地任务状态组装素材摘要，并按筛选与分页返回可用产物。
import { readdir, readFile, stat, writeFile, mkdir, rename, rm, open } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join, extname, basename } from 'node:path'
import { openLocalMedia } from './local-media.js'
import { findJobRoot } from '../jobs/paths.js'
import { getJob } from '../jobs/query.js'
import { readJson, saveJson } from '../jobs/store.js'
import { invalidRequest } from '../../http/shared.js'
import { requiredConfig } from '../../config.js'

export function jobSummary(job) {
  const image = job.result?.media_kind === 'image' || job.capability === 'image-generate' || ['image-generate', 'image-compose'].includes(job.debug?.effective_input?.capability)
  const mode = job.debug?.effective_input?.mode
  const model = job.result?.model || (mode === 'i2va' ? job.server?.connection?.image_model : job.server?.connection?.text_model) || job.server?.connection?.model
  return { job_id: job.job_id, server: job.server ? { server_id: job.server.server_id, provider: job.server.provider, ...(model ? { model } : {}) } : undefined, project_id: job.project_id, status: job.status,
    stage: job.status === 'failed' ? job.failed_stage : job.workflow?.stage || job.stage,
    error_code: job.error_code, remote_status: job.remote_status,
    error: job.error, retryable: job.retryable, retry_scope: job.retry_scope,
    validation: job.result?.validation,
    timings: job.timings, profile: job.result?.profile, specification: job.result?.specification,
    comfyui_view_url: job.result?.comfyui_view_url,
    media_kind: job.result?.media_kind === 'file' ? 'file' : image ? 'image' : 'video',
    has_download: job.status === 'succeeded' && Boolean(job.result?.local_media_path || job.result?.comfyui_view_url),
    has_image: job.status === 'succeeded' && image && Boolean(job.result?.local_media_path || job.result?.comfyui_view_url),
    has_video: job.status === 'succeeded' && Boolean(job.result?.local_media_path || job.result?.comfyui_view_url) && !image && job.result?.media_kind !== 'file' }
}

export async function availableJobSummary(job) {
  const summary = jobSummary(job)
  if (job.result?.local_media_path !== undefined) {
    try { const media = await openLocalMedia(job); await media.handle.close() }
    catch (error) { return { ...summary, has_image: false, has_video: false, has_download: false, media_error: error.message } }
  }
  return summary
}

export function assetSummary(job) {
  const prompt = typeof job.debug?.effective_input?.prompt === 'string' ? job.debug.effective_input.prompt.trim() : ''
  return { ...jobSummary(job), title: job.title, prompt_excerpt: prompt.slice(0, 500) }
}

// 从素材库移除产物，保留任务与原文件供已有项目引用。
export async function deleteAsset(jobId) {
  const job = await getJob(jobId)
  if (job.status !== 'succeeded') throw invalidRequest('只能删除已完成素材')
  const { directory } = await findJobRoot(jobId)
  await writeFile(join(directory, 'asset-deleted.json'), '{}', { mode: 0o600 })
  return { deleted: true }
}

// 流式接收本地图片或视频，在文件与登记写完后发布到素材库。
export async function uploadAsset(req, filename) {
  const extension = extname(filename || '').toLowerCase()
  const kinds = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.mp4': 'video' }
  const kind = kinds[extension]
  if (!kind) throw invalidRequest('请选择 PNG、JPEG、WebP 图片或 MP4 视频')
  const id = randomBytes(16).toString('hex'), root = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'uploads')
  const temporary = join(root, `${id}.tmp`), path = `media/${id}${extension}`
  let size = 0, header = Buffer.alloc(0)
  await mkdir(join(temporary, 'media'), { recursive: true })
  try {
    const file = await open(join(temporary, path), 'wx', 0o600)
    try {
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk); size += bytes.length
        if (size > 512 * 1024 * 1024) throw Object.assign(new Error('素材文件最多 512 MB'), { status: 413 })
        if (header.length < 12) header = Buffer.concat([header, bytes.subarray(0, 12 - header.length)])
        await file.writeFile(bytes)
      }
    } finally { await file.close() }
    const valid = extension === '.png' ? header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : ['.jpg', '.jpeg'].includes(extension) ? header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
      : extension === '.webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
      : header.toString('ascii', 4, 8) === 'ftyp'
    if (!size || !valid) throw invalidRequest('文件内容与图片或视频格式不符')
    const job = { job_id: id, backend: 'upload', title: basename(filename).slice(0, 200), status: 'succeeded', result: { media_kind: kind, local_media_path: path } }
    await saveJson(join(temporary, 'media', 'manifest.json'), { files: [{ path, job_id: id, size_bytes: size }] })
    await saveJson(join(temporary, 'status.json'), job)
    await rename(temporary, join(root, id))
    return assetSummary(job)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

export async function listAssets(offset, limit, filters = {}) {
  const root = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'projects')
  const projects = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const items = []
  const projectMaterials = new Set()
  if (filters.source === 'project') for (const project of projects.filter(project => project.isDirectory() && /^[a-f0-9]{8}$/.test(project.name))) {
    const directory = join(root, project.name)
    const materials = await readJson(join(directory, 'materials.json'))
    const metadata = materials ? null : await readJson(join(directory, 'project.json'))
    for (const id of materials || metadata?.materials || []) projectMaterials.add(id)
  }
  const sources = projects.filter(project => project.isDirectory() && /^[a-f0-9]{8}$/.test(project.name)).map(project => ({ directory: join(root, project.name, 'jobs'), projectId: project.name }))
  sources.push({ directory: join(requiredConfig('ELYSIUM_STATE_ROOT'), 'uploads') })
  for (const source of sources) {
    const jobs = await readdir(source.directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const entry of jobs) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue
      const path = join(source.directory, entry.name, 'status.json')
      try {
        if (await readJson(join(source.directory, entry.name, 'asset-deleted.json'))) continue
        const job = JSON.parse(await readFile(path, 'utf8')); job.project_id ||= source.projectId
        if (filters.source === 'creation' && !source.projectId || filters.source === 'import' && source.projectId || filters.source === 'project' && !projectMaterials.has(job.job_id)) continue
        const summary = { ...assetSummary(job), ...await availableJobSummary(job) }
        if (filters.q && ![job.job_id, job.title, job.debug?.effective_input?.prompt].some(text => typeof text === 'string' && text.toLowerCase().includes(filters.q.toLowerCase()))) continue
        if (job.status === 'succeeded' && (!filters.profile || (summary.profile === 'hd' ? 'high-quality' : summary.profile) === (filters.profile === 'hd' ? 'high-quality' : filters.profile)) && (!filters.media_kind || summary.media_kind === filters.media_kind)) items.push({ ...summary, created_at: (await stat(path)).mtimeMs })
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    }
  }
  items.sort((a, b) => b.created_at - a.created_at || a.job_id.localeCompare(b.job_id))
  return { items: items.slice(offset, offset + limit), total: items.length, has_more: offset + limit < items.length }
}
