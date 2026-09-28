// 面板与会话共用的操作入口。具体操作按领域位于 operations/：
//   registry（合法操作与名称）、execute（分派流水线）、finish（结束时释放节点）、
//   project / story / images / films（各领域处理函数）。
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { linkStore } from '../data/links.js'
import { endExecution, executionContext, startExecution } from '../data/task-records.js'
import { checkContext } from '../data/self-checks.js'
import { produceShots } from '../workers/shot-film-worker.js'
import { executeOperation } from './operations/execute.js'
import { releaseOperation } from './operations/finish.js'

export { operationLabel, validateOperation } from './operations/registry.js'
export { filmSubmit, formatFilmRequest, prepareFilmOpening, previewFilmSubmit } from './operations/films.js'
export { saveIncoming } from './operations/project.js'

const running = new Set()

export async function runOperation(operation, deps) {
  if (['produce', 'produce-all'].includes(operation.action)) return produceShots(operation, deps, runOperation)
  deps.signal?.throwIfAborted()
  const key = operation.projectId ? resolve(deps.home, 'storages', 'meiji', 'projects', operation.projectId) + (operation.episodeId ? ':' + operation.episodeId : '') + (operation.track ? ':' + operation.track : '') : null
  if (key && [...running].some(active => active === key || active.startsWith(key + ':') || key.startsWith(active + ':'))) throw Object.assign(new Error('上一项面板操作还在进行'), { status: 409 })
  if (key) running.add(key)
  const background = []
  const operationId = deps.operationId || randomUUID()
  const state = { failure: undefined, execution: undefined }
  const context = { review: '', operationId, signal: deps.signal, requirements: operation.requirements || '', requestedMode: operation.mode }
  const finish = async () => {
    try { await releaseOperation({ operation, deps, operationId, context, key, state }) }
    finally {
      try { await endExecution(state.execution, state.failure, deps.signal) } finally { if (key) running.delete(key) }
    }
  }
  try {
    if (operation.sessionId && operation.projectId) await linkStore(deps.home).requireProject(operation.sessionId, operation.projectId)
    state.execution = await startExecution(deps.home, operation, operationId)
    if (state.execution) state.execution.signal = deps.signal
    const trace = await executionContext.run(state.execution, () => checkContext.run(context, () => executeOperation(operation, { ...deps, operationId, defer: job => { background.push(job) } })))
    trace.status = background.length ? 'running' : 'completed'
    return trace
  } catch (error) { state.failure = error; throw error } finally {
    if (background.length && deps.waitForBackground) { await Promise.allSettled(background); await finish() }
    else if (background.length) void Promise.allSettled(background).then(finish).catch(() => {})
    else await finish()
  }
}
