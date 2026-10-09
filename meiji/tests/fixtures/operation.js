// 业务职责测试通过真实 Run 单步执行；即时编辑不建立制作记录。
import { randomUUID } from 'node:crypto'
import { projectStore } from '../../server/data/project-store.js'
import { episodeModel } from '../../server/models/data/drama-model.js'
import { materialize } from '../../shared/episode-rules.js'
import { goalRequest } from '../../client/goal-request.js'
import { planRun } from '../../shared/run-planner.js'
import { createRunEngine } from '../../server/flow/runs/run-engine.js'
import { executeRunStep } from '../../server/flow/shared/task-executor.js'
import { createImmediateService } from '../../server/flow/immediate-service.js'
import { reviewPass } from './review-result.js'
import { storyboardReady, videoReady, tailReady } from '../../server/flow/steps/shared/film-freshness.js'
import { runStore } from '../../server/data/run-store.js'
export async function runOperation(operation, deps) {
  deps.signal?.throwIfAborted()
  if (!deps.generateEpisode && !['summary', 'episode-generate', 'episode-summary-draft'].includes(operation.action)) deps = { ...deps, generateEpisode: async ({ project }) => ({ summary: '展示摘要', durationSeconds: project.durationSeconds }) }
  const target = goalRequest(operation.action, operation)
  if (!target) {
    const edits = createImmediateService({ home: deps.home, workspaceController: deps.workspaceController, deps })
    try {
      const started = edits.start(operation, deps.session, deps), result = await started.done
      if (started.failure) throw started.failure
      const trace = result.trace || []; trace.result = result.result; return trace
    } finally { await edits.dispose() }
  }
  let root = await projectStore(deps.home).read(operation.projectId), episodeId = operation.episodeId || (root.episodes.length === 1 && target.goal.to !== 'story' ? root.episodes[0].id : null)
  // 未指定剧集的摘要目标新建下一集（与 run-service 确认时一致：先建立空剧集，再由步骤保存正文）。
  if (!episodeId && target.goal.to === 'story' && !target.goal.draft) {
    episodeId = randomUUID()
    root = await projectStore(deps.home).save(root.id, current => ({ ...current, episodes: [episodeModel(episodeId, { durationSeconds: target.goal.durationSeconds || 150 }), ...current.episodes] }))
  }
  // 面板的生成按钮默认重做目标对象；显式 mode: 'generate' 表示只做未满足的部分（已完成的跳过）。
  const goal = { ...target.goal, mode: target.goal.mode === 'generate' && !operation.mode ? 'regenerate' : target.goal.mode }
  const view = episodeId && !['project-summary', 'script-revise', 'script-sync'].includes(goal.to) ? materialize(root, episodeId) : root
  // 与 run-service 相同的就绪判断：已完成的分镜、视频、尾帧在「只做未满足部分」时跳过。
  const freshness = Object.fromEntries((view.shots?.items || []).map(shot => [shot.id, { storyboard: storyboardReady(view, shot.id), video: videoReady(shot), tail: tailReady(shot) }]))
  const plan = planRun(view, goal, { freshness })
  const syncRequest = async message => {
    if (message.skill === 'review') return reviewPass
    const project = await projectStore(deps.home).read(root.id), episode = project.episodes.find(item => item.summary.basis?.scriptSyncedRevision !== item.summary.revision)
    const exists = project.scriptSections.sections.some(item => item.episodeId === episode?.id)
    return JSON.stringify(project.scriptKind === 'assembled' && episode && !exists ? { needsChange: true, note: '测试回写', changes: [{ target: { kind: 'episode', episodeId: episode.id }, before: '', after: episode.summary.content }] } : { needsChange: false, note: '无需修改', changes: [] })
  }
  const engine = createRunEngine({ home: deps.home, execute: (run, step, context) => {
    if (['wait_confirm', 'wait_script_confirm'].includes(step.kind)) return { confirmed: true }
    if (step.kind === 'expand') return projectStore(deps.home).read(root.id).then(current => ({ steps: planRun(materialize(current, episodeId), step.input.goal, { freshness: {}, ...step.input.policy }).steps }))
    // 剧情任务附带的补图：测试未注入图片接口时不访问网络，按空结果完成。
    if (step.kind === 'image' && step.origin === 'expand' && !deps.fetchImpl) return {}
    const request = step.kind === 'sync' && goal.to !== 'script-sync' ? syncRequest : deps.request || (!deps.fetchImpl ? async message => { if (message.skill === 'review') return reviewPass; throw new Error('未注入测试生成请求') } : undefined)
    return executeRunStep(run, step, { ...deps, ...context, request })
  } })
  let run, abort
  try {
    run = await engine.create({ projectId: root.id, episodeId, goal, steps: plan.steps })
    abort = () => { void engine.cancel(root.id, run.id) }
    deps.signal?.addEventListener('abort', abort, { once: true })
    await engine.confirm(root.id, run.id); await engine.drain()
    const current = await engine.get(root.id, run.id), reason = current.failure || current.pause?.reasons[0]
    // 一次调用代表一个独立目标：执行失败与审核用尽都作为拒绝返回，收尾时结束未完成的任务以便测试发起下一个目标。
    if (reason?.code === 'review_exhausted') {
      const issues = current.steps.find(step => step.id === reason.stepId)?.output?.issues || []
      throw Object.assign(new Error(`自审未通过：${issues.map(issue => typeof issue === 'string' ? issue : [issue.location, issue.reason, issue.requirement].filter(Boolean).join('；')).join('；') || reason.message}`), { code: 'CONTENT_CHECK_FAILED', status: 422, run: current })
    }
    if (reason) throw Object.assign(new Error(reason.message), { code: reason.code, run: current })
    if (current.status === 'cancelled') throw deps.signal?.reason || new Error('任务已取消')
    const trace = current.steps.flatMap(step => step.output?.trace || []); trace.result = current.steps.findLast(step => step.output?.result)?.output.result || {}; return trace
  } finally {
    deps.signal?.removeEventListener('abort', abort)
    if (run) { const left = await engine.get(root.id, run.id); if (!['completed', 'failed', 'cancelled'].includes(left.status)) { await engine.cancel(root.id, run.id); await engine.drain().catch(() => {}) } }
    await engine.dispose()
  }
}
// 最近一次涉及 target 的任务；steps 只含该对象的步骤，attempts 为这些步骤内部动作的种类（图片三步、程序审核等）。
export async function latestRun(home, projectId, target) {
  const run = (await runStore(home, projectId).list()).filter(item => !target || item.steps.some(step => step.target === target)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]
  if (!run) return null
  const steps = run.steps.filter(step => !target || step.target === target)
  return { ...run, steps, kinds: steps.map(step => step.kind), attempts: steps.flatMap(step => (step.attempts || []).map(attempt => attempt.kind || attempt.label)) }
}
