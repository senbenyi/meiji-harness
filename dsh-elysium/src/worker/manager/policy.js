// 职责：任务复用与重试策略：何时复用会话内的原任务、何时允许恢复、恢复时是否重提失败的原工作流。
import { ModelTaskError } from '../../utils/errors.js'
import { findJobCall } from '../intake/calls.js'
import { getJob } from '../runner/inspect.js'

export const CAPABILITIES = Object.freeze({ image: 'workflow-image', video: 'workflow-video' })
export const kindOf = capability => Object.keys(CAPABILITIES).find(kind => CAPABILITIES[kind] === capability)
export const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

// 复用：本会话同项目最近一次同类任务未完成、失败或在本轮已成功时复用它；上一轮之前已成功的任务不复用。
export async function reusableTask(kind, projectId, invocation) {
  if (!invocation?.sessionId) return null
  const calls = (invocation.calls || []).filter(call => call.kind === kind)
  for (const call of calls.reverse()) {
    const previous = await findJobCall(invocation.sessionId, call.callId, invocation)
    if (!previous) continue
    const job = await getJob(previous)
    if (job.project_id !== projectId) continue
    return job.status === 'succeeded' && !call.currentTurn ? null : job
  }
  return null
}

// 恢复前提：任务类型匹配，且用户已明确同意（Agent 需用户原话要求；工作卡按钮本身即同意）。
export function assertRetryAllowed(job, kind, consent) {
  if (job.capability !== CAPABILITIES[kind]) throw invalid(kind === 'video' ? '只能恢复视频工作流；原子产物请按顺序导入新工作流' : '只能恢复图片任务')
  if (!consent) throw new ModelTaskError('MODEL_RETRY_CONFIRMATION_REQUIRED', '等待用户明确要求重试后才能恢复原任务', 409)
}

// 本轮已有另一次恢复调用绑定到同一任务时不再重复启动。
export async function retriedThisTurn(kind, jobId, invocation) {
  if (!invocation?.sessionId) return false
  for (const call of invocation.calls || []) {
    if (!call.currentTurn || call.kind !== kind || call.action !== 'recover' || call.callId === invocation.callId) continue
    if (await findJobCall(invocation.sessionId, call.callId, invocation) === jobId) return true
  }
  return false
}

// 失败的 ComfyUI 任务恢复时按已保存的图重提；三方任务只查询原远端任务，从不重提。
export const resubmitFailed = job => job.status === 'failed' && job.backend === 'comfyui'
