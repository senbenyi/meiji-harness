// 职责：从本地任务状态组装素材摘要，并按筛选与分页返回可用产物。
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { openLocalMedia } from './local-media.js'
import { requiredConfig } from '../config.js'

export function jobSummary(job) {
  const image = job.result?.media_kind === 'image' || job.capability === 'image-generate' || ['image-generate', 'image-compose'].includes(job.debug?.effective_input?.capability)
  return { job_id: job.job_id, project_id: job.project_id, status: job.status,
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
  return { ...jobSummary(job), prompt_excerpt: prompt.slice(0, 500) }
}

export async function listAssets(offset, limit, filters = {}) {
  const root = join(requiredConfig('ELYSIUM_STATE_ROOT'), 'projects')
  const projects = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const items = []
  for (const project of projects) {
    if (!project.isDirectory() || !/^[a-f0-9]{8}$/.test(project.name)) continue
    const jobs = await readdir(join(root, project.name, 'jobs'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const entry of jobs) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue
      const path = join(root, project.name, 'jobs', entry.name, 'status.json')
      try {
        const job = JSON.parse(await readFile(path, 'utf8')); job.project_id ||= project.name
        const summary = { ...assetSummary(job), ...await availableJobSummary(job) }
        if (filters.q && ![job.job_id, job.debug?.effective_input?.prompt].some(text => typeof text === 'string' && text.toLowerCase().includes(filters.q.toLowerCase()))) continue
        if (job.status === 'succeeded' && (!filters.profile || (summary.profile === 'hd' ? 'high-quality' : summary.profile) === (filters.profile === 'hd' ? 'high-quality' : filters.profile)) && (!filters.media_kind || summary.media_kind === filters.media_kind)) items.push({ ...summary, created_at: (await stat(path)).mtimeMs })
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    }
  }
  items.sort((a, b) => b.created_at - a.created_at || a.job_id.localeCompare(b.job_id))
  return { items: items.slice(offset, offset + limit), total: items.length, has_more: offset + limit < items.length }
}
