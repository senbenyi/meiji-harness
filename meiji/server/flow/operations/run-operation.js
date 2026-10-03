// 面板与会话共用入口：锁定与任务上下文 → 项目/剧集准备 → 领域操作 → 状态释放与任务收尾。
// 嵌套操作复用同一任务；后台图片/视频完成后才释放操作。
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { linkStore } from '../../data/workspace-links.js'
import { endExecution, runStep, startExecution } from '../../runtime/task-execution.js'
import { executionContext, executionSteps } from '../../runtime/task-context.js'
import { recorded } from '../../runtime/task-state.js'
import { checkContext, apiFailed } from '../../runtime/operation-context.js'
import { planSteps, runnerStep, validateOperation, episodeScoped } from './operation-registry.js'
import { operations } from './registry.js'
import { materialize, normalizeProject } from '../../../shared/episode-rules.js'
import { scopeProjects } from '../../data/episode-data.js'
import { readImageDraft } from '../../data/image-storage.js'
import { revisionStore, projectStore } from '../../data/project-store.js'
import { prepareChecks, setCheck } from '../../runtime/review-checks.js'
import { feedbackOf } from '../../../shared/review-feedback.js'
import { canGenerate } from '../../../shared/generation-gates.js'
import { assetStore } from '../../data/asset-library-store.js'
import { modelStore } from '../../data/model-settings.js'
import { allNodes, GenerationStatus, modelPatch, targetNode } from '../../../shared/drama-model.js'

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
    return await executionContext.run(state.execution, () => checkContext.run(context, () => single ? runStep(single.kind, execute, { target: single.target }) : execute()))
  } catch (error) { state.failure = error; throw error } finally {
    if (background.length && deps.waitForBackground) { await Promise.allSettled(background); await finish() }
    else if (background.length) void Promise.allSettled(background).then(finish).catch(() => {})
    else await finish()
  }
}


async function executeOperation(operation, deps) {
  const { home } = deps
  const storedProjects = projectStore(home)
  const models = modelStore(home)
  const library = assetStore(home)
  const rootProjects = revisionStore(storedProjects, deps.operationId, operation)
  const trace = []
  const c = { operation, deps, home, storedProjects, rootProjects, projects: rootProjects, models, library, project: null, submittedReview: '', trace, note: line => { trace.push(line) } }
  const handler = operations[operation.action]
  try {
    if (handler?.stage === 'pre') return await handler.run(c)
    const project = c.operation.projectId ? normalizeProject(await rootProjects.read(c.operation.projectId)) : null
    if (project) checkContext.getStore().originalRoot = structuredClone(project)
    if (!project) throw Object.assign(new Error('没有找到项目'), { status: 404 })
    c.project = project
    if (handler?.stage === 'project') return await handler.run(c)
    if (episodeScoped.has(c.operation.action) && !c.operation.episodeId && (c.operation.sessionId || c.project.episodes.length)) {
      if (c.project.episodes.length !== 1) throw Object.assign(new Error('请指定 episodeId 或从对应剧集面板发起操作'), { status: 409 })
      c.operation = { ...c.operation, episodeId: c.project.episodes[0].id }
    }
    if (c.operation.episodeId && episodeScoped.has(c.operation.action)) {
      c.project = materialize(c.project, c.operation.episodeId)
      c.projects = scopeProjects(rootProjects, c.operation.episodeId, c.operation.track)
    }
    if (handler?.stage === 'review') return await handler.run(c)
    if (c.operation.generationMode === 'modify' && c.project.pendingImages?.[c.operation.draftId]) {
      const candidate = c.project.pendingImages[c.operation.draftId]
      if (!candidate.prompt) candidate.prompt = (await readImageDraft(home, c.operation.draftId)).metadata.prompt || ''
    }
    c.submittedReview = String(c.operation.review || '').trim()
    const prepared = await prepareChecks(c.projects, c.project, c.operation)
    c.projects = prepared.store
    c.project = prepared.project
    c.operation = prepared.operation
    if (['storyboard', 'shot-boards'].includes(c.operation.action) && !canGenerate(c.project, 'storyboard')) {
      throw Object.assign(new Error('镜头表尚未通过自检：' + (feedbackOf(c.project, 'shots').check.failures || ['请先生成并检查镜头表']).join('；')), { status: 409 })
    }
    if (handler?.stage === 'episode') return await handler.run(c)
    throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  } catch (error) {
    if (apiFailed() || error.apiFailure) throw error
    const { operation: current } = c
    if (current.projectId) {
      try {
        const saved = await rootProjects.read(current.projectId)
        if (saved.activeOperation === deps.operationId) {
          if (error.code === 'CONTENT_CHECK_FAILED' && current.action === 'episode-generate' && current.episodeId) {
            await scopeProjects(rootProjects, current.episodeId, current.track).save(current.projectId, view => setCheck(structuredClone(view), current, [...feedbackOf(view, current).check.failures, error.message]))
          }
          await c.projects.save(current.projectId, { activity: null, activityError: error.message })
        }
      } catch { /* Conflicting results are discarded; the owner releases its activity in finish. */ }
    }
    throw error
  }
}

async function releaseOperation({ operation, deps, operationId, context, state }) {
  if (!operation.projectId || context.projectDeleted || operation.action === 'episode-summary-draft') return
  const steps = executionSteps(state.execution)
  // 步骤之外的接口失败只记在错误上（见 markApiFailure）。
  const apiFailure = steps.some(step => step.apiFailure) || Boolean(state.failure?.apiFailure)
  const draftSaved = steps.some(step => step.saved)
  // 用户明确重新生成剧情时旧数据已清空，失败也不恢复上次的剧情和图片关联。
  const restoreOriginal = apiFailure && !draftSaved && !(operation.action === 'outline' && context.generationMode === 'regenerate')
  await projectStore(deps.home).save(operation.projectId, current => {
    const next = structuredClone(current)
    let changed = false
    for (const episode of next.episodes) {
      if (restoreOriginal) {
        const original = context.originalRoot?.episodes.find(item => item.id === episode.id)
        const owned = allNodes(episode).filter(target => target.operation?.id === operationId).map(target => target.id)
        const restore = new Set(owned)
        for (const id of owned) {
          const [kind, track] = id.split(':')
          const downstream = kind === 'film' && track ? ['tailFrame'] : kind === 'shot' && track ? ['seconds', 'storyboard', 'pencil', 'film', 'tailFrame'] : kind === 'seconds' && track ? ['storyboard', 'pencil', 'film', 'tailFrame'] : kind === 'storyboard' && track ? ['pencil', 'film', 'tailFrame'] : []
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
          if (!completed && ['outline', 'shots', 'revise-shot', 'seconds', 'shot-seconds', 'shot-storyboard', 'shot-boards', 'film', 'films'].includes(operation.action)) episode.assembly = structuredClone(original.assembly)
          episode.activity = null
          episode.activityError = original.activityError || null
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
        if (completedStoryStage || (!stopped && target.check?.passed != null)) {
          target.operation = null
          target.error = null
          target.status = target.check.passed ? GenerationStatus.PASSED : GenerationStatus.FAILED
        } else {
          target.error = state.failure?.message || '任务已停止，请重新发起'
          target.status = GenerationStatus.FAILED
          target.operation = null
        }
        episodeChanged = true
        changed = true
      }
      if (episode.id === operation.episodeId && episode.activity && !allNodes(episode).some(n => n.operation)) { episode.activity = null; episodeChanged = true; changed = true }
      if (episodeChanged) episode.status = modelPatch(episode, {}).status
    }
    if (next.activeOperation === operationId) { next.activity = null; next.activeOperation = null; if (apiFailure) next.activityError = context.originalRoot?.activityError || null; changed = true }
    return changed ? next : null
  })
}
