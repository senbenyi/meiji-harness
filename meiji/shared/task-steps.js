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

// 每个目标最后一个已完成、带结论的步骤；状态与失败理由共用这一口径。
function latestReviews(steps) {
  const latest = new Map()
  for (const step of steps) if (step.status === StepStatus.COMPLETED && step.verdict) latest.set(step.target || '', step)
  return [...latest.values()]
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
  if (reviewPassed(steps) === false) return TaskStatus.REVIEW_FAILED
  return TaskStatus.COMPLETED
}

// 各目标最新结论为不通过的理由。
export function reviewFailures(steps = []) {
  return latestReviews(steps).filter(step => step.verdict === 'fail').flatMap(step => step.reasons || [])
}

// 有审核步骤时，全部目标最新结论通过为 true，否则 false；没有审核步骤为 null。
export function reviewPassed(steps = []) {
  const reviews = latestReviews(steps)
  return reviews.length ? reviews.every(step => step.verdict === 'pass') : null
}

// 操作状态由其任务状态推导（任务状态由 deriveTaskStatus 从节点推导）：
// 全部排队 → 排队中；有执行中、等待 → 执行中；有失败 → 失败；有审核未通过 → 审核未通过；有取消 → 已取消；
// 已开始但仍有排队 → 执行中；全部完成 → 完成。没有任务的操作视为完成。
// 失败与审核未通过优先于取消：按停止规则，其余任务是因它们而被取消的，操作状态反映根因。
export function deriveOperationStatus(taskStatuses = []) {
  const has = status => taskStatuses.includes(status)
  if (!taskStatuses.length) return TaskStatus.COMPLETED
  if (taskStatuses.every(status => status === TaskStatus.QUEUED)) return TaskStatus.QUEUED
  if (has(TaskStatus.RUNNING) || has(TaskStatus.WAITING)) return TaskStatus.RUNNING
  if (has(TaskStatus.FAILED)) return TaskStatus.FAILED
  if (has(TaskStatus.REVIEW_FAILED)) return TaskStatus.REVIEW_FAILED
  if (has(TaskStatus.CANCELLED)) return TaskStatus.CANCELLED
  if (has(TaskStatus.QUEUED)) return TaskStatus.RUNNING
  return TaskStatus.COMPLETED
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
