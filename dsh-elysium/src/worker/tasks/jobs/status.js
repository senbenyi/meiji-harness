// 职责：任务状态机的唯一写入口，以及任务结果对 Agent、工作卡和素材库的统一汇总。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, saveJson } from '../../../database/json.js'
import { ModelTaskError } from '../../../utils/errors.js'

/*
 * 状态流转（stage 只描述 running 内部进度，不参与流转校验）：
 *   (无) → queued | running | succeeded | failed
 *   queued → queued | running | failed           launcher 重新排队、worker 开始执行
 *   running → queued | running | succeeded | failed   原 worker 已停止时由 launcher 接管
 *   failed → queued | running | failed           仅经恢复重新排队
 *   succeeded 为终态，任何写入都被拒绝，保护已交付结果。
 */
const NEXT = {
  none: ['queued', 'running', 'succeeded', 'failed'],
  queued: ['queued', 'running', 'failed'],
  running: ['queued', 'running', 'succeeded', 'failed'],
  failed: ['queued', 'running', 'failed'],
  succeeded: [],
}

// 所有 status.json 写入必须经过此函数；非法流转抛错而不是覆盖。created_at 为首次写入时间，跨重试保留。
export async function saveStatus(directory, status) {
  const path = join(directory, 'status.json'), current = await readJson(path), state = current?.status || 'none'
  if (!NEXT[state]?.includes(status.status)) throw new ModelTaskError('JOB_STATE_INVALID', `任务状态不能从 ${state} 变为 ${status.status}`, 409)
  status.created_at = current?.created_at || status.created_at || new Date().toISOString()
  await saveJson(path, status)
  return status
}

// 开始执行：写入 running 初始状态。
export const startStatus = (directory, fields) => saveStatus(directory, { ...fields, status: 'running', stage: 'prepare' })

// 执行成功：写入结果；配置了诊断路径时同步保存诊断快照。
export async function succeedStatus(directory, status, result) {
  Object.assign(status, { result, status: 'succeeded', stage: 'completed', finished_at: new Date().toISOString() })
  await saveStatus(directory, status)
  if (status.debug?.diagnostic_path) await saveJson(status.debug.diagnostic_path, status)
  return status
}

// 执行失败：统一失败字段，保留失败阶段和恢复范围；配置了日志时追加错误。
export async function failStatus(directory, status, error, { code, retry_scope, recovery_instruction }) {
  Object.assign(status, { failed_stage: status.stage, stage: 'failed', status: 'failed', error_code: error.code || code,
    error: String(error.message).slice(0, 1000), retry_scope, ...(recovery_instruction ? { recovery_instruction } : {}), finished_at: new Date().toISOString() })
  if (status.debug?.log_path) {
    await mkdir(directory, { recursive: true })
    await writeFile(status.debug.log_path, status.error + '\n', { flag: 'a' })
  }
  await saveStatus(directory, status)
  if (status.debug?.diagnostic_path) await saveJson(status.debug.diagnostic_path, status)
  return status
}

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
