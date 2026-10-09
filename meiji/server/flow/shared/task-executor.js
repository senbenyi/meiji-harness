// Run 单步与即时保存共用：项目/剧集准备 → 领域处理 → 状态释放。
// 每个步骤使用独立上下文；后台图片/视频完成后才释放队列名额。
import { linkStore } from '../../data/workspace-links.js'
import { runNode } from '../../runtime/step-execution.js'
import { executionContext, executionNodes } from '../../runtime/task-context.js'
import { checkContext, apiFailed } from '../../runtime/operation-context.js'
import { materialize, normalizeProject } from '../../../shared/episode-rules.js'
import { scopeProjects } from '../../data/episode-data.js'
import { readImageDraft } from '../../data/image-storage.js'
import { revisionStore, projectStore } from '../../data/project-store.js'
import { prepareChecks, setCheck } from '../../runtime/review-checks.js'
import { feedbackOf } from '../../../shared/review-feedback.js'
import { canGenerate } from '../../../shared/generation-gates.js'
import { assetStore } from '../../data/asset-library-store.js'
import { runContentReview } from '../tasks/task-review-content.js'
import { modelStore } from '../../data/model-settings.js'
import { allNodes, GenerationStatus, modelPatch, targetNode } from '../../models/data/drama-model.js'
import { markFailed, markPendingReview, refreshEpisodeStatus, settleByCheck } from '../../models/tasks/content-state.js'
import { startRunExecution } from '../../runtime/run-execution.js'
import { taskDefinition } from '../tasks/task-registry.js'
import { textStepRegistry } from '../tasks/text-step-registry.js'
import { operations } from '../operations/operation-registry.js'
import { requireStepContent } from '../../../shared/text-step-target.js'



// 修订步骤开始前记下待修订的基稿（与审核输入同一格式），供随后的复审对照修订范围。
function rememberRevisionBase(c) {
  const steps = c.deps.task?.steps, context = checkContext.getStore()
  if (c.operation.step !== 'revise' || !c.deps.runId || !steps?.reviewInput || context.revisionBase !== undefined) return
  try { context.revisionBase = steps.reviewInput(c.project, c.operation, requireStepContent(c.project, c.deps.task.target, c.operation.episodeId)).text }
  catch { context.revisionBase = null }
}

async function executeOperation(operation, deps) {
  const { home } = deps
  const storedProjects = projectStore(home)
  const models = modelStore(home)
  const library = assetStore(home)
  const rootProjects = revisionStore(storedProjects, deps.writeToken, operation)
  if (deps.runId) {
    const save = rootProjects.save.bind(rootProjects)
    // 取消后晚到的正文不再提交；失败事实的落定（settling，如远端视频未取消）仍需写入。
    const stopLate = () => { if (!checkContext.getStore()?.settling) deps.signal?.throwIfAborted() }
    rootProjects.save = (id, patch) => save(id, async current => {
      stopLate()
      const changes = typeof patch === 'function' ? await patch(current) : patch
      stopLate()
      return changes
    })
  }
  const trace = []
  const c = { operation, deps, home, storedProjects, rootProjects, projects: rootProjects, models, library, project: null, submittedReview: '', trace, note: line => { trace.push(line) } }
  const handler = deps.task.definition
  try {
    if (handler?.stage === 'pre') return await handler.run(c)
    const project = c.operation.projectId ? normalizeProject(await rootProjects.read(c.operation.projectId)) : null
    if (project) checkContext.getStore().originalRoot = structuredClone(project)
    if (!project) throw Object.assign(new Error('没有找到项目'), { status: 404 })
    c.project = project
    if (handler?.stage === 'project') rememberRevisionBase(c)
    if (handler?.stage === 'project') return operation.step === 'review' && !operation.draft && !(deps.runId && deps.task.target === 'script') ? await runContentReview(c) : await handler.run(c)
    if (handler.stage !== 'project' && !c.operation.episodeId && (c.operation.sessionId || c.project.episodes.length)) {
      if (c.project.episodes.length !== 1) throw Object.assign(new Error('请指定 episodeId 或从对应剧集面板发起操作'), { status: 409 })
      c.operation = { ...c.operation, episodeId: c.project.episodes[0].id }
    }
    if (c.operation.episodeId && handler.stage !== 'project') {
      c.project = materialize(c.project, c.operation.episodeId)
      c.projects = scopeProjects(rootProjects, c.operation.episodeId, c.operation.action === 'shot-seconds' ? undefined : c.operation.track)
    }
    // 未发布的角色原文只作为修订输入，不写回内容节点或角色库。
    if (c.operation.action === 'characters' && c.operation.generationMode === 'modify' && !c.project.plot.characters.items.length) {
      const records = await executionContext.getStore().store.list('artifacts')
      const latest = records.filter(item => item.target === 'characters' && item.episodeId === c.operation.episodeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      if (latest?.published === false && latest.content?.text) {
        const context = checkContext.getStore()
        context.failedCharacterDraft = latest.content.text
        context.revisionBase = latest.content.text
      }
    }
    rememberRevisionBase(c)
    if (operation.step === 'review') return await runContentReview(c)
    if (handler?.skip?.(c.project, c.operation)) return c.trace
    if (handler?.stage === 'review') return await handler.run(c)
    if (c.operation.generationMode === 'modify' && c.project.pendingImages?.[c.operation.draftId]) {
      const candidate = c.project.pendingImages[c.operation.draftId]
      if (!candidate.prompt) candidate.prompt = (await readImageDraft(home, c.operation.draftId)).metadata.prompt || ''
    }
    c.submittedReview = String(c.operation.review || '').trim()
    const prepared = await prepareChecks(c.projects, c.project, c.operation)
    c.prepared = true
    c.projects = prepared.store
    c.project = prepared.project
    c.operation = prepared.operation
    if (['storyboard'].includes(c.operation.action) && !canGenerate(c.project, 'storyboard')) {
      throw Object.assign(new Error('镜头表尚未通过自检：' + (feedbackOf(c.project, 'shots').check.failures || ['请先生成并检查镜头表']).join('；')), { status: 409 })
    }
    if (handler?.stage === 'episode') return await handler.run(c)
    throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  } catch (error) {
    // 人物审核不进入生成准备；步骤异常也要写回当前人物节点，资产页才能展示并重试。
    if (c.operation.step === 'review' && deps.task.target === 'characters' && c.project) {
      await c.projects.save(c.operation.projectId, current => {
        const next = structuredClone(current), target = targetNode(next, 'characters')
        if (target) markFailed(target, error.message)
        return next
      }).catch(() => {}) // 版本冲突时保留新内容，失败仍记在原 Run。
    }
    if (apiFailed() || error.apiFailure) throw error
    const { operation: current } = c
    if (current.projectId) {
      try {
        if (error.code === 'CONTENT_CHECK_FAILED' && current.action === 'episode-generate' && current.episodeId) {
          await scopeProjects(rootProjects, current.episodeId, current.track).save(current.projectId, view => setCheck(structuredClone(view), current, [...feedbackOf(view, current).check.failures, error.message]))
        }
        // 已开始执行（本集有内容节点归本操作所有）的操作：失败原因只记在目标内容节点上；未开始就失败（如参数校验）不写任何数据。
        if (c.prepared && allNodes(await c.projects.read(current.projectId)).some(node => node.operation?.id === deps.writeToken)) {
          await c.projects.save(current.projectId, {}, { final: true, ...(error.code === 'CONTENT_CHECK_FAILED' ? {} : { error: error.message }) })
        }
      } catch { /* Conflicting results are discarded; releaseOperation settles owned nodes. */ }
    }
    throw error
  }
}

async function releaseOperation({ operation, deps, writeToken, context, state }) {
  if (!operation.projectId || context.projectDeleted || operation.draft) return
  const nodes = executionNodes(state.execution)
  // 步骤之外的接口失败只记在错误上（见 markApiFailure）。
  const apiFailure = nodes.some(step => step.apiFailure) || Boolean(state.failure?.apiFailure)
  const draftSaved = nodes.some(step => step.saved)
  // 用户明确重新生成剧情时旧数据已清空，失败也不恢复上次的剧情和图片关联。
  const restoreOriginal = apiFailure && !draftSaved && !(operation.action === 'outline' && context.generationMode === 'regenerate')
  await projectStore(deps.home).save(operation.projectId, current => {
    const next = structuredClone(current)
    let changed = false
    if (next.summary.operation?.id === writeToken) {
      if (restoreOriginal && context.originalRoot?.summary.content) next.summary = structuredClone(context.originalRoot.summary)
      else if ((state.failure && state.failure.code !== 'CONTENT_CHECK_FAILED') || deps.signal?.aborted) markFailed(next.summary, state.failure?.message || '任务已停止，请重新发起')
      else if (context.step === 'generate' || context.step === 'revise') { next.summary.operation = null; markPendingReview(next.summary) }
      else if (next.summary.check?.passed != null) settleByCheck(next.summary)
      else markFailed(next.summary, state.failure?.message || '任务已停止，请重新发起')
      changed = true
    }
    for (const episode of next.episodes) {
      if (restoreOriginal) {
        const original = context.originalRoot?.episodes.find(item => item.id === episode.id)
        const owned = allNodes(episode).filter(target => target.operation?.id === writeToken).map(target => target.id)
        const restore = new Set(owned)
        for (const id of owned) {
          const [kind, track] = id.split(':')
          const downstream = kind === 'film' && track ? ['tailFrame'] : kind === 'shot' && track ? ['seconds', 'storyboard', 'film', 'tailFrame'] : kind === 'seconds' && track ? ['storyboard', 'film', 'tailFrame'] : kind === 'storyboard' && track ? ['film', 'tailFrame'] : []
          for (const child of downstream) restore.add(`${child}:${track}`)
        }
        if (owned.length && original) {
          for (const id of restore) {
            const target = targetNode(episode, id), previous = targetNode(original, id)
            if (!target || !previous || (target.operation && target.operation.id !== writeToken)) continue
            const review = target.review, draft = target.draft
            Object.assign(target, structuredClone(previous), { review, draft, operation: previous.operation?.phase === 'awaiting-confirmation' ? structuredClone(previous.operation) : null })
          }
          if (operation.draftId && original.pendingImages?.[operation.draftId]) episode.pendingImages[operation.draftId] = structuredClone(original.pendingImages[operation.draftId])
          if (owned.includes('outline')) episode.shots = structuredClone(original.shots)
          const completed = allNodes(episode).some(value => !restore.has(value.id) && value.check?.passed === true && value.revision !== targetNode(original, value.id)?.revision)
          if (!completed && ['outline', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'shot-storyboard', 'film', 'films'].includes(operation.action)) episode.assembly = structuredClone(original.assembly)
          Object.assign(episode, modelPatch(episode, {}))
          changed = true
        }
        continue
      }
      let episodeChanged = false
      const stopped = Boolean(state.failure) || Boolean(deps.signal?.aborted)
      for (const target of allNodes(episode)) {
        if (target.operation?.id !== writeToken || target.operation.phase === 'awaiting-confirmation') continue
        const completedStoryStage = context.storyStages && target.operation.phase === 'reviewed' && target.check?.passed === true
        if (!stopped && ['generate', 'revise'].includes(context.step)) { target.operation = null; target.error = null; markPendingReview(target) }
        else if (completedStoryStage || ((!stopped || state.failure?.code === 'CONTENT_CHECK_FAILED') && target.check?.passed != null)) settleByCheck(target)
        else markFailed(target, state.failure?.message || '任务已停止，请重新发起')
        episodeChanged = true
        changed = true
      }
      if (episodeChanged) refreshEpisodeStatus(episode)
    }
    return changed ? next : null
  })
}

async function storedImageResult(home, projectId, episodeId, itemId) { const root = await projectStore(home).read(projectId); return Object.values(root.episodes.find(item => item.id === episodeId)?.pendingImages || {}).some(draft => draft.itemId === itemId) }

// 即时保存只执行业务处理，不建立制作任务、旧任务记录或后台生成队列。
export async function executeImmediate(operation, definition, deps) {
  const task = { type: 'save', operation, target: (typeof definition.step === 'function' ? definition.step(operation) : definition.step)?.target || null, definition: { ...definition, run: c => taskDefinition('save').run(c, definition) } }
  const state = { execution: null, failure: null }, background = []
  const context = { writeToken: deps.editId, signal: deps.signal, step: deps.deferReview ? 'generate' : undefined, review: '', requirements: '', maxRevisions: 0 }
  return executionContext.run(null, () => checkContext.run(context, async () => {
    try {
      const trace = await executeOperation(operation, { ...deps, immediate: true, task, writeToken: deps.editId, defer: job => background.push(job) })
      const outcomes = await Promise.allSettled(background), failed = outcomes.find(item => item.status === 'rejected')
      if (failed) throw failed.reason
      return { trace: [...trace], result: trace.result || {} }
    } catch (error) { state.failure = error; throw error }
    finally { await Promise.allSettled(background); await releaseOperation({ operation, deps, writeToken: deps.editId, context, state }) }
  }))
}

// 业务单步沿用正文校验、保存和释放规则，不建立旧任务/操作记录。
export async function executeRunStep(run, step, deps) {
  const definition = step.input.directAction ? { ...operations[step.input.directAction], run: c => taskDefinition('save').run(c, operations[step.input.directAction]) } : taskDefinition(step.input.taskType)
  const textKind = ['generate', 'revise', 'review', 're_review'].includes(step.kind)
  const mode = step.kind === 'revise' ? 'modify' : 'generate'
  const operation = { ...step.input.operation, projectId: run.projectId, episodeId: run.episodeId,
    sessionId: run.sessionId, ...(textKind ? { step: ['review', 're_review'].includes(step.kind) ? 'review' : step.kind, mode, generationMode: mode === 'modify' ? 'modify' : 'regenerate' } : {}) }
  // 自动修订的意见取自正文节点上本轮审核结论（prepareChecks 合并）；不写入人工意见栏，也不受人工输入长度限制。
  const task = { type: step.input.taskType, target: step.target, definition, operation, steps: textStepRegistry[step.target?.split(':')[0]] }
  const execution = await startRunExecution(deps.home, run, step, operation)
  execution.signal = deps.signal
  const state = { execution, failure: null }, background = []
  const context = { runId: run.id, writeToken: step.id, taskType: task.type, signal: deps.signal, step: operation.step, steps: task.steps,
    review: operation.review || '', requirements: operation.requirements || '', maxRevisions: step.kind === 'sync' ? 2 : 0, repairRevisions: run.policy?.maxRevisions ?? 0, requestedMode: mode,
    ...(step.input.baseNode && operation.track ? { baseline: { episodes: [{ id: run.episodeId, shots: { items: [{ id: operation.track, seconds: step.input.baseNode }] } }] } } : {}) }
  return executionContext.run(execution, () => checkContext.run(context, async () => {
    try {
      if (run.sessionId) await linkStore(deps.home).requireProject(run.sessionId, run.projectId)
      const trace = await executeOperation(operation, { ...deps, run, step, runId: run.id, task, writeToken: step.id, defer: job => background.push(job) })
      const pending = await Promise.allSettled(background), failed = pending.find(item => item.status === 'rejected')
      if (failed) throw failed.reason
      if (step.kind === 'sync' && trace.result?.reviewPassed === false) throw new Error('剧本回写未通过审核，请处理后重试')
      return textKind && ['review', 're_review'].includes(step.kind) ? { passed: trace.result.reviewPassed, issues: execution.verdict?.issues || [], result: trace.result } : { trace: [...trace], result: trace.result || null, ...(context.revisionBase ? { revisionBase: context.revisionBase } : {}) }
    } catch (error) { state.failure = error; throw error }
    finally { await Promise.allSettled(background); await releaseOperation({ operation, deps: { ...deps, writeToken: step.id }, writeToken: step.id, context, state }) }
  }))
}
