// 面板与会话共用的操作入口。具体操作按领域位于 operations/：
//   registry（操作定义与步骤计划）、execute（分派流水线）、finish（结束时释放节点）、
//   project / story / images / films（各领域处理函数）。
// 每次执行对应一个任务：开始时写入步骤计划；没有计划的操作整体作为一个步骤执行。
// 组合操作（逐镜成片）经 deps.runOperation 调用子操作；子操作复用同一任务（嵌套执行：不另加锁、不单独结束任务）。
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { linkStore } from '../../data/workspace-links.js'
import { endExecution, executionContext, recorded, runStep, startExecution } from '../../data/task-store.js'
import { checkContext } from '../../data/operation-context.js'
import { planSteps, runnerStep, validateOperation } from './registry.js'
import { executeOperation } from './execute.js'
import { releaseOperation } from './finish.js'

export { operationLabel, validateOperation } from './registry.js'
export { filmSubmit, formatFilmRequest, prepareFilmOpening, previewFilmSubmit } from './films.js'
export { saveIncoming } from './project.js'

const running = new Set()

export async function runOperation(operation, deps) {
  deps.signal?.throwIfAborted()
  // 会话工具发起的操作一律按操作定义校验（人工专属操作拒绝）。
  if (operation.origin === 'session') validateOperation(operation)
  const operationId = deps.operationId || randomUUID()
  const nested = executionContext.getStore()?.taskId === operationId
  const key = operation.projectId && !nested ? resolve(deps.home, 'storages', 'meiji', 'projects', operation.projectId) + (operation.episodeId ? ':' + operation.episodeId : '') + (operation.track ? ':' + operation.track : '') : null
  if (key && [...running].some(active => active === key || active.startsWith(key + ':') || key.startsWith(active + ':'))) throw Object.assign(new Error('上一项面板操作还在进行'), { status: 409 })
  if (key) running.add(key)
  const background = []
  const state = { failure: undefined, execution: undefined }
  const context = { review: '', operationId, signal: deps.signal, requirements: operation.requirements || '', requestedMode: operation.mode }
  const finish = async () => {
    try { await releaseOperation({ operation, deps, operationId, context, state }) }
    finally {
      try { await endExecution(state.execution, state.failure, deps.signal) } finally { if (key) running.delete(key) }
    }
  }
  try {
    if (operation.sessionId && operation.projectId) await linkStore(deps.home).requireProject(operation.sessionId, operation.projectId)
    const plan = !nested && recorded(operation) ? await planSteps(deps.home, operation) : null
    state.execution = await startExecution(deps.home, operation, operationId, plan)
    if (state.execution) state.execution.signal = deps.signal
    const single = runnerStep(operation)
    const execute = () => executeOperation(operation, { ...deps, operationId, runOperation, defer: job => { background.push(job) } })
    const trace = await executionContext.run(state.execution, () => checkContext.run(context, () => single ? runStep(single.kind, execute, { target: single.target }) : execute()))
    trace.status = background.length ? 'running' : 'completed'
    return trace
  } catch (error) { state.failure = error; throw error } finally {
    if (background.length && deps.waitForBackground) { await Promise.allSettled(background); await finish() }
    else if (background.length) void Promise.allSettled(background).then(finish).catch(() => {})
    else await finish()
  }
}
