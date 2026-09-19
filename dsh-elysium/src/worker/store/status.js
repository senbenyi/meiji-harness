// 职责：任务状态机的唯一写入口。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, saveJson } from '../../database/json.js'
import { ModelTaskError } from '../../utils/errors.js'

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
