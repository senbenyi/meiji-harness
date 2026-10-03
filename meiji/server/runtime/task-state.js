// 无文件 IO 的任务分类、步骤创建和终态规则。
import { randomUUID } from 'node:crypto'
import { StepStatus, deriveTaskStatus, reviewPassed } from '../../shared/task-steps.js'

const now = () => new Date().toISOString()
// 人工编辑：保存后内容待审（见 prepareContentRecords）。
export const manualActions = new Set(['episode-add', 'episode-edit', 'source', 'outline-text', 'scene-text', 'character-text', 'storyboard-text', 'shot-assets'])
// 由人发起的操作，任务与步骤的执行者记为 human。
export const humanActions = new Set([...manualActions, 'overview', 'confirm-image', 'discard-image', 'clear-image', 'use-asset', 'import-image', 'part-import', 'part-text', 'set-reference', 'clear-reference', 'review-override', 'prop-delete'])
// 不写任务记录：没有项目，或会删除记录所在目录。
const unrecorded = new Set(['create', 'open', 'library-import', 'project-delete', 'episode-delete'])
export const recorded = operation => Boolean(operation?.projectId) && !unrecorded.has(operation.action)
export function createStep({ kind, target = null, label = null, phase }, actor) {
  return { id: randomUUID(), kind, target, label, ...(phase ? { phase } : {}), status: StepStatus.PENDING, verdict: null, reasons: [], error: null, actor, attempts: [], inputs: [], outputs: [], startedAt: null, endedAt: null }
}

export function unprepare(step) {
  delete step.preparing
  Object.assign(step, { status: StepStatus.PENDING, startedAt: null })
}

// 任务结束时落定步骤：
// - 被中止：执行中的步骤记为已取消；尚未开始时，第一个未执行步骤记为已取消；
// - 内容校验不通过（CONTENT_CHECK_FAILED）：若最新结论中还没有不通过，追加一个 check 步骤记录结论；
// - 其他错误：若还没有失败步骤，执行中或第一个未执行步骤记为失败；
// - 没有失败或取消时，剩余未执行的步骤记为已跳过。
export function finalizeSteps(steps, error, signal) {
  const at = now()
  // 准备中的步骤没有真正开始：正常结束或内容校验不通过时恢复为未执行（随后记为已跳过）。
  if (!signal?.aborted && (!error || error.code === 'CONTENT_CHECK_FAILED')) for (const step of steps) if (step.preparing) unprepare(step)
  const open = () => steps.find(step => step.status === StepStatus.RUNNING) || steps.find(step => step.status === StepStatus.PENDING)
  const mark = (status, extra = {}) => {
    const step = open()
    if (step) { delete step.preparing; Object.assign(step, { status, endedAt: at, ...extra }) }
    else steps.push({ ...createStep({ kind: 'execute' }, 'model'), status, endedAt: at, ...extra })
  }
  if (signal?.aborted) {
    for (const step of steps) if (step.status === StepStatus.RUNNING) { delete step.preparing; Object.assign(step, { status: StepStatus.CANCELLED, endedAt: at, error: error?.message || '任务已停止' }) }
    if (!steps.some(step => step.status === StepStatus.CANCELLED)) mark(StepStatus.CANCELLED, { error: error?.message || '任务已停止' })
  } else if (error?.code === 'CONTENT_CHECK_FAILED') {
    if (reviewPassed(steps) !== false) {
      const target = [...steps].reverse().find(step => step.target)?.target || null
      steps.push({ ...createStep({ kind: 'check', target }, 'model'), status: StepStatus.COMPLETED, verdict: 'fail', reasons: [error.message], startedAt: at, endedAt: at })
    }
  } else if (error && !steps.some(step => step.status === StepStatus.FAILED || step.status === StepStatus.CANCELLED)) {
    mark(StepStatus.FAILED, { error: error.message, ...(error.apiFailure ? { apiFailure: true } : {}) })
  }
  if (!steps.some(step => step.status === StepStatus.FAILED || step.status === StepStatus.CANCELLED)) {
    for (const step of steps) if (step.status === StepStatus.PENDING) Object.assign(step, { status: StepStatus.SKIPPED, endedAt: at })
  }
  return steps
}

// 一个操作的多个任务共用同一执行上下文：步骤按目标（target）归入各自任务。
// tasks 为 [{ id, targets }]；targets 为空的任务承接未匹配的步骤（没有则归第一个任务）。只有一个任务时不划分。
export function partitionSteps(steps, tasks) {
  if (!tasks || tasks.length <= 1) return [{ ...(tasks?.[0] || {}), steps }]
  const groups = tasks.map(task => ({ ...task, steps: [] }))
  const fallback = groups.find(group => !group.targets) || groups[0]
  for (const step of steps) (groups.find(group => group.targets?.includes(step.target ?? null)) || fallback).steps.push(step)
  return groups
}

const touched = steps => steps.some(step => step.status !== StepStatus.PENDING || step.preparing)

// 操作结束时逐个任务落定步骤：正在执行（或最后开始）的任务按错误/中止落定；已完成任务剩余的未执行步骤记为跳过；
// 未开始的任务：排在出错任务之后且前序失败、审核未通过或被停止时记为已取消（停止规则），否则记为跳过。新追加的步骤同步回 steps。
export function finalizeTaskGroups(steps, tasks, error, signal) {
  if (!tasks || tasks.length <= 1) return finalizeSteps(steps, error, signal)
  const at = now(), groups = partitionSteps(steps, tasks)
  const started = groups.filter(group => touched(group.steps))
  const current = started.find(group => group.steps.some(step => step.status === StepStatus.RUNNING)) || started.at(-1) || groups[0]
  for (const group of groups) {
    if (group !== current && !started.includes(group)) continue
    const before = new Set(group.steps)
    finalizeSteps(group.steps, group === current ? error : null, group === current ? signal : null)
    for (const step of group.steps) if (!before.has(step)) steps.push(step)
  }
  const stopped = groups.some(group => (group === current || started.includes(group)) && deriveTaskStatus(group.steps) !== 'completed')
  // 停止规则只作用于出错任务之后的任务；排在它之前、因内容已完成而未执行的任务记为跳过。
  const stopAt = groups.indexOf(current)
  groups.forEach((group, index) => {
    if (group === current || started.includes(group)) return
    for (const step of group.steps) Object.assign(step, stopped && index > stopAt ? { status: StepStatus.CANCELLED, error: '前序任务未完成，已停止', endedAt: at } : { status: StepStatus.SKIPPED, endedAt: at })
  })
  return steps
}

// 步骤所属任务记录的 id（单任务时为执行上下文的 taskId）。
export function taskIdOfStep(context, stepId) {
  if (!context.tasks || context.tasks.length <= 1) return context.taskId
  return partitionSteps(context.steps, context.tasks).find(group => group.steps.some(step => step.id === stepId))?.id || context.taskId
}
