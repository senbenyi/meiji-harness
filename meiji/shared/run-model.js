// Run 是可恢复的用户目标，Step 是不可删除的执行历史；本模块不做 IO。
export const RUN_SCHEMA = 1
export const RunStatus = Object.freeze({ DRAFT: 'draft', RUNNING: 'running', PAUSED: 'paused', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' })
export const StepStatus = Object.freeze({ PENDING: 'pending', READY: 'ready', RUNNING: 'running', DONE: 'done', PAUSED: 'paused', SUPERSEDED: 'superseded', SKIPPED: 'skipped', FAILED: 'failed', CANCELLED: 'cancelled' })
export const StepKinds = Object.freeze(['generate', 'review', 'revise', 're_review', 'manual_edit', 'override', 'image', 'wait_confirm', 'wait_script_confirm', 'storyboard', 'video', 'tail', 'assemble', 'sync', 'expand'])
const success = new Set(['done', 'skipped'])
const terminal = new Set(['done', 'skipped', 'superseded', 'failed', 'cancelled'])
export const isRunEnded = run => ['completed', 'failed', 'cancelled'].includes(deriveRunStatus(run))

export function deriveRunStatus(run) {
  if (run.events.some(event => event.type === 'cancelled' && !event.stepIds)) return RunStatus.CANCELLED
  if (!run.events.some(event => event.type === 'confirmed')) return RunStatus.DRAFT
  if (run.failure) return RunStatus.FAILED
  const steps = run.steps.filter(step => step.status !== StepStatus.SUPERSEDED)
  if (run.pause?.reasons?.length || steps.some(step => step.status === StepStatus.PAUSED)) return RunStatus.PAUSED
  if (steps.every(step => terminal.has(step.status))) return steps.some(step => step.status === StepStatus.CANCELLED) ? RunStatus.CANCELLED : RunStatus.COMPLETED
  return RunStatus.RUNNING
}

// 被动中断（步骤报错、自动修订用尽、服务重启中断）直接结束任务：失败步骤记为 failed，其余未完成步骤全部作废。
// 等待确认、前置授权和用户暂停不走这里；之后再点生成会新建任务。
export const failurePauseCodes = Object.freeze(['step_failed', 'review_exhausted', 'interrupted'])
export function failRun(run, steps, code, message, at = new Date().toISOString()) {
  const failed = new Set(steps.map(step => step.id))
  for (const step of steps) { step.status = StepStatus.FAILED; step.error = message; step.endedAt = at }
  for (const step of run.steps) if (!failed.has(step.id) && !terminal.has(step.status)) { step.status = StepStatus.SUPERSEDED; step.endedAt = at }
  run.pause = null
  run.failure = { code, stepId: steps[0]?.id || null, target: steps[0]?.target || null, message, at }
  run.events.push({ at, type: 'failed', actor: 'engine', stepIds: [...failed], payload: { code, message } })
  return run
}

export function readySteps(run) {
  if (!run.events.some(event => event.type === 'confirmed') || isRunEnded(run) || run.pause?.reasons?.some(reason => reason.code === 'user_paused')) return []
  const byId = new Map(run.steps.map(step => [step.id, step]))
  return run.steps.filter(step => ['pending', 'ready'].includes(step.status) && step.after.every(id => success.has(byId.get(id)?.status)))
}

export function downstreamSteps(steps, id) {
  const ids = new Set([id])
  let size
  do { size = ids.size; for (const step of steps) if (step.after.some(parent => ids.has(parent))) ids.add(step.id) } while (size !== ids.size)
  return steps.filter(step => ids.has(step.id))
}

export function validateRun(run) {
  const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_RUN', status: 422 }) }
  if (run.schemaVersion !== RUN_SCHEMA || !run.id || !run.projectId || !Array.isArray(run.steps) || !Array.isArray(run.events)) invalid('任务记录格式无效')
  const byId = new Map()
  for (const step of run.steps) {
    if (!step.id || byId.has(step.id)) invalid('步骤 ID 重复或为空')
    if (!step.key || !StepKinds.includes(step.kind) || !Object.values(StepStatus).includes(step.status) || !Array.isArray(step.after)) invalid('步骤格式无效')
    if (!['project', 'episode'].includes(step.scope) || step.scope === 'episode' && !run.episodeId) invalid('步骤执行范围无效')
    if (![null, 'text', 'image', 'video'].includes(step.queue)) invalid('步骤队列无效')
    byId.set(step.id, step)
  }
  const visiting = new Set(), done = new Set()
  const visit = id => {
    if (!byId.has(id)) invalid('步骤依赖不存在')
    if (visiting.has(id)) invalid('步骤依赖有环')
    if (done.has(id)) return
    visiting.add(id)
    for (const parent of byId.get(id).after) {
      if (byId.get(parent)?.status === StepStatus.SUPERSEDED && !terminal.has(byId.get(id).status)) invalid('有效步骤仍依赖作废步骤')
      visit(parent)
    }
    visiting.delete(id); done.add(id)
  }
  for (const id of byId.keys()) visit(id)
  return run
}
