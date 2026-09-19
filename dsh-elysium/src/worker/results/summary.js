// 职责：任务结果对 Agent、工作卡和素材库的统一汇总口径。
import { ModelTaskError } from '../../utils/errors.js'

// 已成功任务的完整结果，供 Agent 取用媒体 URL 与诊断。
export function completedResult(job) {
  if (job.status !== 'succeeded' || !job.result) {
    throw new ModelTaskError('MODEL_JOB_NOT_READY', `任务尚未成功：${job.status}`, 409)
  }
  const output = { job_id: job.job_id, status: job.status, trace_id: job.trace_id, parent_job_id: job.parent_job_id,
    stage: job.stage, server: job.server, code_version: job.code_version, ...job.result, debug: job.debug }
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined))
}

// 任务摘要：工作卡、Agent 工具渲染和素材库共用的唯一口径。
export function jobSummary(job, { mode: requestedMode, inferMediaKind = true } = {}) {
  const result = job.result || job
  const image = result.media_kind === 'image' || job.capability === 'image-generate' || ['image-generate', 'image-compose'].includes(job.debug?.effective_input?.capability)
  const mode = requestedMode || job.debug?.effective_input?.mode
  const model = result.model || job.model || (mode === 'i2va' ? job.server?.connection?.image_model : job.server?.connection?.text_model) || job.server?.connection?.model
  const quality = result.quality || ({ preview: 'fast', regular: 'regular', 'high-quality': 'high', hd: 'high' })[result.profile]
  return { job_id: job.job_id, server: job.server ? { server_id: job.server.server_id, provider: job.server.provider, ...(model ? { model } : {}) } : undefined, project_id: job.project_id, status: job.status,
    stage: job.status === 'failed' ? job.failed_stage : job.workflow?.stage || job.stage,
    failed_stage: job.failed_stage,
    error_code: job.error_code, remote_status: job.remote_status,
    error: job.error, retryable: job.retryable, retry_scope: job.retry_scope, recovery_instruction: job.recovery_instruction,
    validation: result.validation, warnings: result.warnings || job.warnings,
    quality, profile: result.profile, specification: result.specification,
    comfyui_view_url: result.comfyui_view_url, comfyui_metadata_status: result.comfyui_metadata_status,
    media_kind: result.media_kind === 'file' ? 'file' : result.media_kind || (inferMediaKind ? image ? 'image' : 'video' : undefined),
    diagnostic_path: job.status === 'succeeded' ? undefined : job.debug?.diagnostic_path,
    log_path: job.status === 'succeeded' ? undefined : job.debug?.log_path,
    node_errors: job.status !== 'succeeded' && job.debug?.node_errors?.length ? job.debug.node_errors : undefined,
    has_download: job.status === 'succeeded' && Boolean(result.local_media_path || result.comfyui_view_url),
    has_image: job.status === 'succeeded' && image && Boolean(result.local_media_path || result.comfyui_view_url),
    has_video: job.status === 'succeeded' && Boolean(result.local_media_path || result.comfyui_view_url) && !image && result.media_kind !== 'file' }
}
