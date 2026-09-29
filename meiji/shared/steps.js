// 任务步骤模型（前后端共用）：步骤状态、任务状态推导、审核结论与按目标分组。
// 任务状态只由 deriveTaskStatus 从步骤计算，任何代码都不直接给任务状态赋值。

export const StepStatus = Object.freeze({
  PENDING: 'pending',       // 未执行
  RUNNING: 'running',       // 执行中
  WAITING: 'waiting',       // 等待人工（预留）
  COMPLETED: 'completed',   // 完成
  FAILED: 'failed',         // 失败
  CANCELLED: 'cancelled',   // 已取消
  SKIPPED: 'skipped',       // 已跳过
})

export const TaskStatus = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING: 'waiting',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  REVIEW_FAILED: 'review_failed',
  COMPLETED: 'completed',
})

// 会产生审核结论的步骤类型；check 为保存时的内容校验（如时长不符）。
export const reviewKinds = new Set(['review', 're_review', 'check', 'override'])

// 每个目标最后一个已完成、带结论步骤的结论（pass / fail）。
export function latestVerdicts(steps = []) {
  const verdicts = new Map()
  for (const step of steps) {
    if (step.status === StepStatus.COMPLETED && step.verdict) verdicts.set(step.target || '', step.verdict)
  }
  return verdicts
}

// 按优先级推导（顺序执行，同一时刻最多一个步骤在执行）：
// 全部未执行 → 排队中；有执行中 → 执行中；有等待人工 → 等待人工；有已取消 → 已取消；有失败 → 失败；
// 仍有未执行（两个步骤之间）→ 执行中；最新审核结论有不通过 → 审核未通过；其余 → 完成。
export function deriveTaskStatus(steps = []) {
  const has = status => steps.some(step => step.status === status)
  if (!steps.length || steps.every(step => step.status === StepStatus.PENDING)) return TaskStatus.QUEUED
  if (has(StepStatus.RUNNING)) return TaskStatus.RUNNING
  if (has(StepStatus.WAITING)) return TaskStatus.WAITING
  if (has(StepStatus.CANCELLED)) return TaskStatus.CANCELLED
  if (has(StepStatus.FAILED)) return TaskStatus.FAILED
  if (has(StepStatus.PENDING)) return TaskStatus.RUNNING
  if ([...latestVerdicts(steps).values()].includes('fail')) return TaskStatus.REVIEW_FAILED
  return TaskStatus.COMPLETED
}

// 各目标最新结论为不通过的理由。
export function reviewFailures(steps = []) {
  const latest = new Map()
  for (const step of steps) if (step.status === StepStatus.COMPLETED && step.verdict) latest.set(step.target || '', step)
  return [...latest.values()].filter(step => step.verdict === 'fail').flatMap(step => step.reasons || [])
}

// 有审核步骤时，全部目标最新结论通过为 true，否则 false；没有审核步骤为 null。
export function reviewPassed(steps = []) {
  const verdicts = [...latestVerdicts(steps).values()]
  return verdicts.length ? verdicts.every(value => value === 'pass') : null
}

export const taskEnded = steps => ![TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.WAITING].includes(deriveTaskStatus(steps))

// 面板按目标分组展示；没有目标的步骤归入「本任务」。
export function groupByTarget(steps = []) {
  const groups = []
  for (const step of steps) {
    const key = step.target || ''
    let group = groups.find(item => item.target === key)
    if (!group) groups.push(group = { target: key, steps: [] })
    group.steps.push(step)
  }
  return groups.map(group => ({ ...group, status: deriveTaskStatus(group.steps) }))
}

// 当前步骤：执行中或等待人工的步骤；没有则为 null。
export const currentStep = steps => steps.find(step => step.status === StepStatus.RUNNING || step.status === StepStatus.WAITING) || null

// 顺序执行声明式步骤：when（可为异步）返回 false 的步骤不执行（任务结束时对应的计划步骤记为已跳过）；
// 每个步骤的 run 接收此前步骤的结果（state），返回值存入 state[name]。
export async function executeSteps(steps, state = {}) {
  for (const step of steps) {
    if (step.when && !(await step.when(state))) continue
    state[step.name] = await step.run(state)
  }
  return state
}
