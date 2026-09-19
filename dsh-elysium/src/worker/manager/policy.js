// 职责：任务复用与重试策略：何时复用会话内的原任务、何时允许恢复、恢复时是否重提失败的原工作流。
import { ModelTaskError } from '../../utils/errors.js'
import { MEDIA_TOOLS, findJobCall, mediaToolNames } from '../intake/calls.js'
import { getJob } from '../runner/inspect.js'

export const CAPABILITIES = Object.freeze({ image: 'workflow-image', video: 'workflow-video' })
export const kindOf = capability => Object.keys(CAPABILITIES).find(kind => CAPABILITIES[kind] === capability)
export const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

const sessionOf = exec => exec?.agent?.session
const turnStartOf = events => events.findLastIndex(event => event.type === 'turn/start')

// 复用：本会话同项目最近一次同类任务未完成、失败或在本轮已成功时复用它；上一轮之前已成功的任务不复用。
export async function reusableTask(kind, projectId, exec) {
  const session = sessionOf(exec)
  if (!session) return null
  const events = session.snapshotEvents(), turnStart = turnStartOf(events)
  const calls = events.map((event, index) => ({ event, index })).filter(({ event }) => event.type === 'tool/call' && mediaToolNames(kind).includes(event.data.name))
  for (const { event, index } of calls.reverse()) {
    const previous = await findJobCall(session.id, event.data.callId, session)
    if (!previous) continue
    const job = await getJob(previous)
    if (job.project_id !== projectId) continue
    return job.status === 'succeeded' && index <= turnStart ? null : job
  }
  return null
}

// 恢复前提：任务类型匹配，且用户已明确同意（Agent 需用户原话要求；工作卡按钮本身即同意）。
export function assertRetryAllowed(job, kind, consent) {
  if (job.capability !== CAPABILITIES[kind]) throw invalid(kind === 'video' ? '只能恢复视频工作流；原子产物请按顺序导入新工作流' : '只能恢复图片任务')
  if (!consent) throw new ModelTaskError('MODEL_RETRY_CONFIRMATION_REQUIRED', '等待用户明确要求重试后才能恢复原任务', 409)
}

// 本轮已有另一次恢复调用绑定到同一任务时不再重复启动。
export async function retriedThisTurn(kind, jobId, exec) {
  const session = sessionOf(exec)
  if (!session) return false
  const events = session.snapshotEvents()
  for (const event of events.slice(turnStartOf(events) + 1)) {
    if (event.type !== 'tool/call' || event.data.name !== MEDIA_TOOLS[kind].recover || event.data.callId === exec.callId) continue
    if (await findJobCall(session.id, event.data.callId, session) === jobId) return true
  }
  return false
}

// 失败的 ComfyUI 任务恢复时按已保存的图重提；三方任务只查询原远端任务，从不重提。
export const resubmitFailed = job => job.status === 'failed' && job.backend === 'comfyui'
