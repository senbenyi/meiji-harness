// 面板与会话共用入口：锁定与任务上下文 → 项目/剧集准备 → 领域操作 → 状态释放与任务收尾。
// 每个任务使用独立上下文；后台图片/视频完成后才释放任务队列名额。
import { linkStore } from '../../data/workspace-links.js'
import { endExecution, runNode, startExecution } from '../../runtime/task-execution.js'
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
import { allNodes, GenerationStatus, modelPatch, targetNode } from '../../../shared/drama-model.js'
import { markFailed, markPendingReview, refreshEpisodeStatus, settleByCheck } from '../../../shared/content-state.js'


// taskId 由操作执行器生成；每个任务拥有独立执行上下文，媒体完成及尾帧成功后才释放队列名额。
export async function executeTask(operation, deps) {
  deps.signal?.throwIfAborted()
  const task = deps.task, taskId = deps.taskId
  const domain = task.operation
  const background = []
  const state = { failure: undefined, execution: undefined }
  const context = { review: '', operationId: deps.operationId, taskId, taskType: task.type, signal: deps.signal,
    requirements: operation.requirements || '', requestedMode: operation.mode, step: operation.step, steps: task.steps, maxRevisions: task.maxRevisions, baseline: deps.baseline }
  try {
    if (operation.sessionId && operation.projectId && !(operation.origin === 'panel' && operation.action === 'project-delete')) await linkStore(deps.home).requireProject(operation.sessionId, operation.projectId)
    state.execution = await startExecution(deps.home, operation, taskId, task.plan, { operationId: deps.operationId, type: task.type, label: task.label, targets: task.targets, actor: task.actor, maxRevisions: task.maxRevisions, stage: task.target?.split(':')[0] })
    if (state.execution) state.execution.signal = deps.signal
    return await executionContext.run(state.execution, () => checkContext.run(context, async () => {
      const trace = await executeOperation(domain, { ...deps, defer: job => { background.push(job) } })
      const outcomes = await Promise.allSettled(background)
      const failure = outcomes.find(item => item.status === 'rejected')
      if (failure) throw failure.reason
      if (domain.action === 'image' && trace) {
        const root = await storedImageResult(deps.home, operation.projectId, operation.episodeId, domain.itemId)
        if (root) trace.result = { ...trace.result, pendingConfirm: true }
      }
      return trace
    }))
  } catch (error) { state.failure = error; throw error }
  finally {
    try { await releaseOperation({ operation: domain, deps, operationId: taskId, context, state }) }
    finally { await endExecution(state.execution, state.failure, deps.signal) }
  }
}


async function executeOperation(operation, deps) {
  const { home } = deps
  const storedProjects = projectStore(home)
  const models = modelStore(home)
  const library = assetStore(home)
  const rootProjects = revisionStore(storedProjects, deps.taskId, operation)
  const trace = []
  const c = { operation, deps, home, storedProjects, rootProjects, projects: rootProjects, models, library, project: null, submittedReview: '', trace, note: line => { trace.push(line) } }
  const handler = deps.task.definition
  try {
    if (handler?.stage === 'pre') return await handler.run(c)
    const project = c.operation.projectId ? normalizeProject(await rootProjects.read(c.operation.projectId)) : null
    if (project) checkContext.getStore().originalRoot = structuredClone(project)
    if (!project) throw Object.assign(new Error('没有找到项目'), { status: 404 })
    c.project = project
    if (handler?.stage === 'project') return operation.step === 'review' ? await runContentReview(c) : await handler.run(c)
    if (handler.stage !== 'project' && !c.operation.episodeId && (c.operation.sessionId || c.project.episodes.length)) {
      if (c.project.episodes.length !== 1) throw Object.assign(new Error('请指定 episodeId 或从对应剧集面板发起操作'), { status: 409 })
      c.operation = { ...c.operation, episodeId: c.project.episodes[0].id }
    }
    if (c.operation.episodeId && handler.stage !== 'project') {
      c.project = materialize(c.project, c.operation.episodeId)
      c.projects = scopeProjects(rootProjects, c.operation.episodeId, c.operation.action === 'shot-seconds' ? undefined : c.operation.track)
    }
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
    if (apiFailed() || error.apiFailure) throw error
    const { operation: current } = c
    if (current.projectId) {
      try {
        if (error.code === 'CONTENT_CHECK_FAILED' && current.action === 'episode-generate' && current.episodeId) {
          await scopeProjects(rootProjects, current.episodeId, current.track).save(current.projectId, view => setCheck(structuredClone(view), current, [...feedbackOf(view, current).check.failures, error.message]))
        }
        // 已开始执行（本集有内容节点归本操作所有）的操作：失败原因只记在目标内容节点上；未开始就失败（如参数校验）不写任何数据。
        if (c.prepared && allNodes(await c.projects.read(current.projectId)).some(node => node.operation?.id === deps.taskId)) {
          await c.projects.save(current.projectId, {}, { final: true, ...(error.code === 'CONTENT_CHECK_FAILED' ? {} : { error: error.message }) })
        }
      } catch { /* Conflicting results are discarded; releaseOperation settles owned nodes. */ }
    }
    throw error
  }
}

async function releaseOperation({ operation, deps, operationId, context, state }) {
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
    if (next.summary.operation?.id === operationId) {
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
        const owned = allNodes(episode).filter(target => target.operation?.id === operationId).map(target => target.id)
        const restore = new Set(owned)
        for (const id of owned) {
          const [kind, track] = id.split(':')
          const downstream = kind === 'film' && track ? ['tailFrame'] : kind === 'shot' && track ? ['seconds', 'storyboard', 'film', 'tailFrame'] : kind === 'seconds' && track ? ['storyboard', 'film', 'tailFrame'] : kind === 'storyboard' && track ? ['film', 'tailFrame'] : []
          for (const child of downstream) restore.add(`${child}:${track}`)
        }
        if (owned.length && original) {
          for (const id of restore) {
            const target = targetNode(episode, id), previous = targetNode(original, id)
            if (!target || !previous || (target.operation && target.operation.id !== operationId)) continue
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
        if (target.operation?.id !== operationId || target.operation.phase === 'awaiting-confirmation') continue
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
