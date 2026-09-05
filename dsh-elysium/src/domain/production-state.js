/**
 * 六状态对外投影。纯逻辑无 I/O。
 *
 * 上游 ai-native-factory-rollout.md §8 要求的对外状态是：
 *   draft → awaiting_authorization → queued → producing → awaiting_review → completed
 * 失败进 needs_attention，由系统先自动重试。
 *
 * 内部状态机（draft/ready/running/paused/needs_attention/awaiting_review/approved）
 * 保持不动，这里只做投影。**没有改写内部机**是刻意的：内部机承载着依赖调度、
 * 恢复和幂等，替换它的风险远大于多一层映射。paused 是用户动作，不在六状态里，
 * 但必须如实透出，否则界面会把"暂停"显示成"生产中"。
 */

export const PUBLIC_STATES = [
  'draft', 'awaiting_authorization', 'queued', 'producing', 'awaiting_review', 'completed',
]

const LABELS = {
  draft: '草稿',
  awaiting_authorization: '等待内容授权',
  queued: '已排队',
  producing: '生产中',
  awaiting_review: '等待人工终审',
  completed: '已完成',
  needs_attention: '需要处理',
  paused: '已暂停',
}

/** 只有这两处允许打断用户；其余一律自动处理或进 needs_attention。 */
function needsUserOf(publicState) {
  if (publicState === 'awaiting_authorization') return 'consent'
  if (publicState === 'awaiting_review') return 'review'
  return null
}

export function publicStateOf(state, plan = null) {
  const status = String(state?.status || 'draft')
  if (status === 'approved') return 'completed'
  if (status === 'awaiting_review') return 'awaiting_review'
  if (status === 'needs_attention') return 'needs_attention'
  if (status === 'paused') return 'paused'
  if (status === 'running') return 'producing'
  if (status === 'ready') return state?.authorizedAt ? 'queued' : 'awaiting_authorization'
  // draft：规划还没定稿就是草稿，定稿了就等授权。
  if (plan && plan.source && plan.source !== 'auto-draft') return 'awaiting_authorization'
  return 'draft'
}

/** 任务完成度。用于单页进度条，不暴露章节/锚点/种子这些术语。 */
export function progressOf(tasks = []) {
  const total = tasks.length
  const succeeded = tasks.filter(task => task.status === 'succeeded').length
  const failed = tasks.filter(task => task.status === 'needs_attention').length
  const active = tasks.filter(task => ['running', 'queued'].includes(task.status)).length
  return {
    total,
    succeeded,
    failed,
    active,
    ratio: total ? Number((succeeded / total).toFixed(4)) : 0,
  }
}

export function describeState(state, plan = null, tasks = []) {
  const publicState = publicStateOf(state, plan)
  return {
    state: publicState,
    label: LABELS[publicState] || publicState,
    needsUser: needsUserOf(publicState),
    progress: progressOf(tasks),
    updatedAt: state?.updatedAt || null,
  }
}
