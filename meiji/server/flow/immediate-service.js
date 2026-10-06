import { randomUUID } from 'node:crypto'
import { validateOperation } from './operations/operation-registry.js'
import { operationScope } from '../../shared/operation-conflicts.js'
import { linkedOperationCard } from '../data/project-files.js'
import { occupy } from './operations/operation-occupancy.js'
import { executeImmediate } from './shared/task-executor.js'
import { notifyProject } from '../data/project-events.js'
import { projectStore } from '../data/project-store.js'
import { linkStore } from '../data/workspace-links.js'
import { historyStore } from '../data/history-store.js'
const reviewedEdits = new Set(['outline-text', 'character-text', 'scene-text', 'prop-text', 'storyboard-text'])
export function createImmediateService({ home, workspaceController, runs, deps = {}, execute = executeImmediate }) {
  const active = new Map()
  return {
    start(input, session, options = {}) {
      const definition = validateOperation(input)
      if (definition.kind !== 'direct') throw Object.assign(new Error('制作请通过任务目标预览发起'), { status: 400, code: 'RUN_GOAL_REQUIRED' })
      const id = randomUUID(), controller = new AbortController()
      const operation = { ...input, ...operationScope({ ...input, kind: 'direct', lock: definition.linkedCard && linkedOperationCard(home, input) ? 'project' : definition.lock }) }
      const release = occupy(home, operation, { id, label: definition.label }), abort = () => controller.abort(options.signal.reason)
      if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true })
      const entry = { id, projectId: operation.projectId, episodeId: operation.episodeId, controller, failure: null }
      active.set(id, entry)
      entry.done = (async () => {
        try {
          controller.signal.throwIfAborted()
          if (operation.projectId && operation.sessionId && operation.action !== 'project-delete') await linkStore(home).requireProject(operation.sessionId, operation.projectId)
          const before = operation.projectId ? await projectStore(home).read(operation.projectId) : null
          const result = await execute(operation, definition, { ...deps, ...options, home, workspaceController: options.workspaceController || workspaceController, editId: id, signal: controller.signal, session, deferReview: reviewedEdits.has(operation.action) })
          if (runs && before && operation.action !== 'project-delete') result.continueRun = await runs.contentChanged(operation, before)
          if (before && operation.action !== 'project-delete') await historyStore(home, before.id).event(operation.action, { episodeId: operation.episodeId || null, ...(result.continueRun ? { runId: result.continueRun.runId } : {}), target: operation.target || operation.track || operation.itemId || null })
          return { ...result, status: 'completed' }
        } catch (error) { entry.failure = error; return { status: 'failed', error: error.message, result: {} } }
        finally { options.signal?.removeEventListener('abort', abort); active.delete(id); release(); if (operation.projectId) notifyProject(home, operation.projectId) }
      })()
      return { id, done: entry.done, ready: Promise.resolve(), get failure() { return entry.failure } }
    },
    list(projectId) { return [...active.values()].filter(entry => entry.projectId === projectId).map(entry => ({ id: entry.id, projectId, episodeId: entry.episodeId, status: 'running' })) },
    current(projectId, episodeId) { return this.list(projectId).filter(entry => !episodeId || !entry.episodeId || entry.episodeId === episodeId) },
    async dispose() { for (const entry of active.values()) entry.controller.abort(new Error('服务已停止')); await Promise.all([...active.values()].map(entry => entry.done)) },
  }
}
