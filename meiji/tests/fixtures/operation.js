// 业务职责测试通过真实 Run 单步执行；即时编辑不建立制作记录。
import { projectStore } from '../../server/data/project-store.js'
import { materialize } from '../../shared/episode-rules.js'
import { goalRequest } from '../../client/goal-request.js'
import { planRun } from '../../shared/run-planner.js'
import { createRunEngine } from '../../server/flow/runs/run-engine.js'
import { executeRunStep } from '../../server/flow/shared/task-executor.js'
import { createImmediateService } from '../../server/flow/immediate-service.js'
import { reviewPass } from './review-result.js'
export async function runOperation(operation, deps) {
  deps.signal?.throwIfAborted()
  const target = goalRequest(operation.action, operation)
  if (!target) {
    const edits = createImmediateService({ home: deps.home, workspaceController: deps.workspaceController, deps })
    try {
      const started = edits.start(operation, deps.session, deps), result = await started.done
      if (started.failure) throw started.failure
      const trace = result.trace || []; trace.result = result.result; return trace
    } finally { await edits.dispose() }
  }
  const root = await projectStore(deps.home).read(operation.projectId), episodeId = operation.episodeId || (root.episodes.length === 1 ? root.episodes[0].id : null)
  const goal = { ...target.goal, mode: target.goal.mode === 'generate' ? 'regenerate' : target.goal.mode }
  const plan = planRun(episodeId && goal.to !== 'project-summary' && goal.to !== 'script-revise' ? materialize(root, episodeId) : root, goal)
  const syncRequest = async message => {
    if (message.skill === 'review') return reviewPass
    const project = await projectStore(deps.home).read(root.id), episode = project.episodes.find(item => item.summary.basis?.scriptSyncedRevision !== item.summary.revision)
    const exists = project.scriptSections.sections.some(item => item.episodeId === episode?.id)
    return JSON.stringify(project.scriptKind === 'assembled' && episode && !exists ? { needsChange: true, note: '测试回写', changes: [{ target: { kind: 'episode', episodeId: episode.id }, before: '', after: episode.summary.content }] } : { needsChange: false, note: '无需修改', changes: [] })
  }
  const engine = createRunEngine({ home: deps.home, execute: (run, step, context) => {
    if (['wait_confirm', 'wait_script_confirm'].includes(step.kind)) return { confirmed: true }
    if (step.kind === 'expand') return projectStore(deps.home).read(root.id).then(current => ({ steps: planRun(materialize(current, episodeId), step.input.goal).steps }))
    const request = step.kind === 'sync' && goal.to !== 'script-sync' ? syncRequest : deps.request || (!deps.fetchImpl ? async message => { if (message.skill === 'review') return reviewPass; throw new Error('未注入测试生成请求') } : undefined)
    return executeRunStep(run, step, { ...deps, ...context, request })
  } })
  let run, abort
  try {
    run = await engine.create({ projectId: root.id, episodeId, goal, steps: plan.steps })
    abort = () => { void engine.cancel(root.id, run.id) }
    deps.signal?.addEventListener('abort', abort, { once: true })
    await engine.confirm(root.id, run.id); await engine.drain()
    const current = await engine.get(root.id, run.id), failure = current.pause?.reasons.find(reason => reason.code !== 'review_exhausted')
    if (failure) throw new Error(failure.message)
    if (current.status === 'cancelled') throw deps.signal?.reason || new Error('任务已取消')
    const trace = current.steps.flatMap(step => step.output?.trace || []); trace.result = current.steps.findLast(step => step.output?.result)?.output.result || {}; return trace
  } finally { deps.signal?.removeEventListener('abort', abort); await engine.dispose() }
}
export async function latestTask(store, target) {
  return (await store.list()).filter(run => !target || run.steps?.some(step => step.target === target)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]
}
