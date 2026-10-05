// 无文件 IO 的任务分类、步骤创建和终态规则。
import { randomUUID } from 'node:crypto'
import { StepStatus, deriveTaskStatus, reviewPassed } from '../../shared/task-nodes.js'

const now = () => new Date().toISOString()
// 创建前的项目摘要草稿独立记录；其他无项目操作或删除操作不留项目记录。
const unrecorded = new Set(['create', 'open', 'library-import', 'project-delete', 'episode-delete'])
export const recorded = operation => (Boolean(operation?.projectId) || operation?.action === 'project-summary' && operation.draft) && !unrecorded.has(operation.action)
export function createNode({ kind, target = null, label = null, phase }, actor) {
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
export function finalizeNodes(nodes, error, signal) {
  const at = now()
  // 准备中的步骤没有真正开始：正常结束或内容校验不通过时恢复为未执行（随后记为已跳过）。
  if (!signal?.aborted && (!error || error.code === 'CONTENT_CHECK_FAILED')) for (const step of nodes) if (step.preparing) unprepare(step)
  const open = () => nodes.find(step => step.status === StepStatus.RUNNING) || nodes.find(step => step.status === StepStatus.PENDING)
  const mark = (status, extra = {}) => {
    const step = open()
    if (step) { delete step.preparing; Object.assign(step, { status, endedAt: at, ...extra }) }
    else nodes.push({ ...createNode({ kind: 'execute' }, 'model'), status, endedAt: at, ...extra })
  }
  if (signal?.aborted) {
    for (const step of nodes) if (step.status === StepStatus.RUNNING) { delete step.preparing; Object.assign(step, { status: StepStatus.CANCELLED, endedAt: at, error: error?.message || '任务已停止' }) }
    if (!nodes.some(step => step.status === StepStatus.CANCELLED)) mark(StepStatus.CANCELLED, { error: error?.message || '任务已停止' })
  } else if (error?.code === 'CONTENT_CHECK_FAILED') {
    if (reviewPassed(nodes) !== false) {
      const target = [...nodes].reverse().find(step => step.target)?.target || null
      nodes.push({ ...createNode({ kind: 'check', target }, 'model'), status: StepStatus.COMPLETED, verdict: 'fail', reasons: [error.message], startedAt: at, endedAt: at })
    }
  } else if (error && !nodes.some(step => step.status === StepStatus.FAILED || step.status === StepStatus.CANCELLED)) {
    mark(StepStatus.FAILED, { error: error.message, ...(error.apiFailure ? { apiFailure: true } : {}) })
  }
  if (!nodes.some(step => step.status === StepStatus.FAILED || step.status === StepStatus.CANCELLED)) {
    for (const step of nodes) if (step.status === StepStatus.PENDING) Object.assign(step, { status: StepStatus.SKIPPED, endedAt: at })
  }
  return nodes
}

export const taskIdOfNode = context => context.taskId
