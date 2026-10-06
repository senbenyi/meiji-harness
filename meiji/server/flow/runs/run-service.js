// 面板与会话共用制作服务；客户端不能指定 step、actor 或执行锁。
import { createRunEngine } from './run-engine.js'
import { executeRunStep } from '../shared/task-executor.js'
import { occupy, occupant } from '../operations/operation-occupancy.js'
import { projectStore } from '../../data/project-store.js'
import { runStore } from '../../data/run-store.js'
import { linkStore } from '../../data/workspace-links.js'
import { notifyProject, subscribeProject } from '../../data/project-events.js'
import { operationDeletes } from '../../../shared/operation-cascade.js'
import { materialize, foldEpisode } from '../../../shared/episode-rules.js'
import { overrideBlocker, overrideNodes } from '../../../shared/review-feedback.js'
import { markPassed, markPendingReview } from '../../../shared/content-state.js'
import { runInScope, runTargetMatches, orderRuns } from '../../../shared/run-view.js'
import { planRun, mergeRunPlans } from '../../../shared/run-planner.js'
import { normalizeRunGoal, goalForRunTarget } from '../../../shared/run-templates.js'
import { imageItems } from '../../../shared/library-images.js'
import { scriptBlockers, scriptFreshness, episodeHints } from '../../../shared/script-assembly.js'
import { randomUUID } from 'node:crypto'
import { episodeModel, targetNode } from '../../../shared/drama-model.js'
import { storyboardReady, videoReady, tailReady } from '../steps/shared/film-freshness.js'
import { libraryTarget } from '../../../shared/library-rules.js'
import { runStageDependencies } from '../../../skills/load-skills.js'
import { historyStore } from '../../data/history-store.js'
import { downstreamSteps } from '../../../shared/run-model.js'

const reject = (message, code = 'RUN_ACTION_INVALID') => Object.assign(new Error(message), { status: 409, code })
export const publicRun = run => {
  const { skillSnapshot, ...record } = run
  return record
}
const summary = run => {
  const { steps, events, request, preview, ...record } = publicRun(run)
  const progress = [...new Set(steps.map(step => step.target))].map(target => { const selected = steps.filter(step => step.target === target && step.status !== 'superseded'); return { target, total: selected.length, done: selected.filter(step => ['done', 'skipped'].includes(step.status)).length, paused: selected.some(step => step.status === 'paused') } })
  return { ...record, done: steps.filter(step => ['done', 'skipped'].includes(step.status)).length, total: steps.filter(step => step.status !== 'superseded').length,
    progress,
    pendingCount: run.pause?.reasons.length || 0, targets: [...new Set(steps.map(step => step.target))],
    activeSteps: steps.filter(step => step.status === 'running').map(step => ({ id: step.id, target: step.target, scope: step.scope, kind: step.kind })) }
}

export function createRunService({ home, execute = executeRunStep, deps = {}, limitOf, queue, onChange }) {
  const projects = projectStore(home), links = linkStore(home), subscriptions = new Map()
  const dependencies = runStageDependencies()
  const plannerView = (root, episodeId) => episodeId && root.episodes.some(item => item.id === episodeId) ? materialize(root, episodeId) : root
  const prospectiveRoot = (root, request) => request?.newEpisode && !root.episodes.some(item => item.id === request.newEpisode.id) ? { ...root, episodes: [episodeModel(request.newEpisode.id, { durationSeconds: request.newEpisode.durationSeconds }), ...root.episodes] } : root
  const goalPlan = (root, run, policy = run.policy) => {
    const previewRoot = prospectiveRoot(root, run.request)
    return mergeRunPlans((run.request.goals || [run.request.goal]).map(goal => planRun(plannerView(previewRoot, run.episodeId), goal, plannerPolicy(previewRoot, policy, run.episodeId))))
  }
  const plannerPolicy = (root, policy = {}, episodeId = null) => {
    const view = plannerView(root, episodeId)
    return { ...policy, stageDependencies: dependencies, projectSummaryRequired: scriptFreshness(root).summaryNeedsUpdate,
      freshness: Object.fromEntries((view.shots?.items || []).map(shot => [shot.id, { storyboard: storyboardReady(view, shot.id), video: videoReady(shot), tail: tailReady(shot) }])) }
  }
  const continuationPlan = (root, run, primary) => {
    if (!primary.goal.feedback && primary.goal.mode !== 'regenerate') return primary
    const view = structuredClone(plannerView(root, run.episodeId)), own = new Set(run.steps.filter(step => !['cancelled', 'superseded'].includes(step.status)).map(step => step.target))
    const affected = new Set(primary.deletions.filter(item => item.episodeId === run.episodeId).map(item => item.track ? `${['video', 'tailFrame'].includes(item.kind) ? 'film' : item.kind}:${item.track}` : item.kind))
    for (const target of affected) {
      const node = targetNode(view, target)
      if (node) { node.content = null; node.check.passed = null; if (node.items) node.items = [] }
    }
    const primaryTargets = new Set(primary.steps.map(step => step.target)), continuation = mergeRunPlans((run.request.goals || [run.request.goal]).map(goal => planRun(view, { ...goal, mode: 'generate', feedback: undefined }, { ...plannerPolicy(root, run.policy, run.episodeId), freshness: {} })))
    for (const prior of run.steps.filter(step => primaryTargets.has(step.target) && !['superseded', 'cancelled'].includes(step.status))) for (const dependent of downstreamSteps(run.steps, prior.id)) if (!primaryTargets.has(dependent.target)) affected.add(dependent.target)
    const selected = continuation.steps.filter(step => !primaryTargets.has(step.target) && (own.has(step.target) && affected.has(step.target) || step.kind === 'expand' && [...affected].some(target => target.startsWith(step.target + ':') && own.has(target))))
    const selectedIds = new Set(selected.map(step => step.id)), primaryTails = primary.steps.filter(step => !primary.steps.some(child => child.after.includes(step.id))).map(step => step.id)
    // 原目标内的下游在新稿审核后重做；其他目标只展示删除事实。
    const idMap = new Map(selected.map(step => [step.id, `cascade-${step.id}`]))
    const steps = selected.map(step => ({ ...step, id: idMap.get(step.id), origin: 'cascade', after: step.after.filter(id => selectedIds.has(id)).map(id => idMap.get(id)) }))
    for (const step of steps) if (!step.after.length) step.after = primaryTails
    return { ...primary, steps: [...primary.steps, ...steps] }
  }
  const checkStep = async (run, step) => {
    if (!step || !run.request?.goal) return null
    const root = await projects.read(run.projectId), view = plannerView(root, run.episodeId)
    if (['outline', 'characters', 'scenes', 'props'].includes(step.target) && !['review', 're_review'].includes(step.kind) && scriptFreshness(root).summaryNeedsUpdate) {
      const entry = { key: 'project-summary@all', goal: { to: 'project-summary' }, message: '剧本已更新，需要更新并审核项目摘要' }
      if (!run.prereq.required.some(item => item.key === entry.key)) await runStore(home, run.projectId).update(run.id, current => { current.prereq.required.push(entry); return current })
      return { pause: { code: 'prereq_required', message: entry.message, actions: ['authorize', 'cancel-branch'] } }
    }
    const required = step.input?.required || []
    for (const entry of required) {
      const prerequisite = planRun(entry.goal.to === 'project-summary' ? root : view, entry.goal, plannerPolicy(root, { review: true }, run.episodeId))
      if (!prerequisite.steps.length || prerequisite.steps.some(item => item.status !== 'skipped')) return { pause: { code: 'prereq_required', message: entry.message, actions: ['authorize', 'cancel-branch'] } }
    }
    if (['summary', 'outline', 'characters', 'scenes', 'props', 'project-summary', 'script'].includes(step.target) && !['review', 're_review', 'sync', 'wait_script_confirm'].includes(step.kind)) {
      const pending = scriptBlockers(root).filter(item => !(step.target === 'summary' && item.episodeId === run.episodeId && item.kind === 'episode-sync'))
      if (pending.length) return { pause: { code: 'script_pending', message: '剧本有待处理回写或方案，请在剧本页处理', actions: ['cancel-branch'] } }
    }
    if (step.kind === 'wait_confirm') {
      if (run.events.some(event => event.type === 'image_discarded' && event.payload.target === step.target && event.at >= (step.createdAt || run.createdAt))) return { skip: true }
      if (step.input.library) {
        const library = step.input.library, variant = libraryTarget(root, library.kind, { libraryId: library.id, variantId: library.variantId })?.variant
        if (!variant) throw reject('库变体不存在')
        if (Object.values(root.pendingImages || {}).some(item => item.variantId === library.variantId) || !variant.image.content) return { pause: { code: 'wait_confirm', message: '请在项目库确认或放弃候选图片', actions: ['cancel-branch'] } }
        return null
      }
      const entry = imageItems(root, view, [step.input.itemId])[0]
      if (entry.pending || !entry.ready) return { pause: { code: 'wait_confirm', message: `请在面板确认 ${entry.name} 的候选图片`, actions: ['cancel-branch'] } }
    }
    if (step.kind === 'wait_script_confirm' && root.scriptProposals.some(item => item.runId === run.id && item.status === 'pending')) return { pause: { code: 'wait_script_confirm', message: '请在剧本页确认或放弃本任务的修改方案', actions: ['cancel-branch'] } }
    return null
  }
  const lockOperation = (run, step) => ({ projectId: run.projectId, episodeId: run.episodeId, target: step.target, action: 'run-step', lock: step.scope, origin: run.initiator, sessionId: run.sessionId })
  const engine = createRunEngine({ home, limitOf, queue,
    beforeStep: checkStep,
    execute: async (run, step, context) => {
      if (step.kind === 'expand') {
        const root = await projects.read(run.projectId), plan = planRun(plannerView(root, run.episodeId), step.input.goal, plannerPolicy(root, run.policy, run.episodeId))
        if (plan.blockers.length) throw new Error(plan.blockers.map(item => item.message).join('；'))
        return { steps: plan.steps }
      }
      if (step.kind === 'wait_script_confirm') {
        const root = await projects.read(run.projectId)
        const affectedEpisodes = root.scriptProposals.some(item => item.runId === run.id && item.status === 'applied') ? root.episodes.filter(episode => episodeHints(root, episode).scriptUpdated).map(episode => episode.id) : []
        return { confirmed: true, affectedEpisodes, optionalGoals: affectedEpisodes.map(episodeId => ({ episodeId, goal: { to: 'summary', mode: 'regenerate' } })) }
      }
      if (step.kind === 'wait_confirm') return { confirmed: true }
      return execute(run, step, { ...deps, ...context, home })
    },
    canAcquireStep: (run, step) => !occupant(home, lockOperation(run, step)),
    acquireStep: (run, step) => occupy(home, lockOperation(run, step), { id: step.id, label: step.label || step.key }),
    onChange: run => { notifyProject(home, run.projectId, run.revision); onChange?.(publicRun(run)) },
  })
  const watch = projectId => {
    if (!subscriptions.has(projectId)) subscriptions.set(projectId, subscribeProject(home, projectId, () => engine.wake()))
  }
  const requireProject = async (projectId, sessionId) => { await links.requireProject(sessionId, projectId); return projects.read(projectId) }
  const owned = async (projectId, id, sessionId) => { await requireProject(projectId, sessionId); return engine.get(projectId, id) }
  const validateConfirm = async (projectId, id, sessionId, { confirmDelete = false, authorizePrereq = [] } = {}) => {
    const run = await owned(projectId, id, sessionId), root = await projects.read(projectId)
    if (run.status !== 'draft') throw reject('只有草稿需要确认')
    if (!Array.isArray(authorizePrereq) || authorizePrereq.some(key => !run.prereq.required.some(item => item.key === key))) throw reject('前置授权无效')
    const previewRoot = prospectiveRoot(root, run.request)
    if (run.request.newEpisode && !root.episodes.some(item => item.id === run.episodeId) && root.episodes.length !== run.request.newEpisode.number - 1) throw reject('剧集顺序已变化，请重新预览', 'RUN_PREVIEW_CHANGED')
    const deletions = run.request.goal ? goalPlan(root, run, { ...run.policy, authorizePrereq }).deletions : operationDeletes(root, run.request)
    if (JSON.stringify(deletions) !== JSON.stringify(run.preview.deletions)) throw reject('删除范围已变化，请重新预览任务', 'RUN_PREVIEW_CHANGED')
    if (deletions.length && !confirmDelete) throw Object.assign(reject('请先确认删除清单', 'DELETIONS_PENDING'), { deletions })
    return { run, deletions }
  }
  return {
    async plan(input, sessionId, initiator = 'panel') {
      if (input.goal) {
        const root = await requireProject(input.projectId, sessionId), goal = normalizeRunGoal(input.goal)
        let episodeId = input.episodeId || (['project-summary', 'script-revise'].includes(goal.to) || goal.draft || goal.scope.library ? null : root.episodes.length === 1 ? root.episodes[0].id : null), newEpisode = null
        if (input.episodeNumber !== undefined) {
          if (!Number.isInteger(input.episodeNumber) || input.episodeNumber < 1 || input.episodeNumber > root.episodes.length + 1) throw reject('剧集不存在，不能跳集')
          if (input.episodeNumber <= root.episodes.length) episodeId = [...root.episodes].reverse()[input.episodeNumber - 1].id
          else if (goal.to !== 'summary' || goal.mode !== 'generate') throw reject('只有生成摘要可以新建下一集')
          else if (!goal.draft) newEpisode = { id: randomUUID(), number: input.episodeNumber, durationSeconds: goal.durationSeconds || 150 }
        } else if (!episodeId && !root.episodes.length && goal.to === 'summary' && !goal.draft) newEpisode = { id: randomUUID(), number: 1, durationSeconds: goal.durationSeconds || 150 }
        if (newEpisode) episodeId = newEpisode.id
        if (!episodeId && !['project-summary', 'script-revise'].includes(goal.to) && !goal.draft && !goal.scope.library) throw reject('请指定剧集')
        if (episodeId && !newEpisode && !root.episodes.some(item => item.id === episodeId) && !(goal.to === 'script-sync' && root.scriptPendingDeletes.some(item => item.episodeId === episodeId))) throw reject('剧集不存在')
        if (input.policy && Object.keys(input.policy).some(key => key !== 'review') || input.policy?.review !== undefined && typeof input.policy.review !== 'boolean') throw reject('审核策略无效')
        if (input.authorizePrereq !== undefined && (!Array.isArray(input.authorizePrereq) || input.authorizePrereq.some(key => typeof key !== 'string'))) throw reject('前置授权无效')
        const policy = { review: input.policy?.review !== false, maxRevisions: goal.mode === 'review' || input.policy?.review === false ? 0 : 2, authorizePrereq: input.authorizePrereq || [] }
        const previewRoot = prospectiveRoot(root, { newEpisode })
        const plan = planRun(plannerView(previewRoot, episodeId), goal, plannerPolicy(previewRoot, policy, episodeId))
        watch(root.id)
        const current = await runStore(home, root.id).openRun(episodeId)
        if (current) return { run: publicRun(current), amend: true, projectRevision: root.revision, ...continuationPlan(root, current, plan) }
        const run = await engine.create({ projectId: root.id, episodeId, sessionId, initiator, callId: typeof input.callId === 'string' ? input.callId : null, goal: plan.goal, policy,
          request: { goal: plan.goal, ...(newEpisode ? { newEpisode } : {}) }, prereq: { required: plan.prereq, authorized: [] }, preview: { deletions: plan.deletions, blockers: plan.blockers }, steps: plan.steps })
        return { run: publicRun(run), deletions: plan.deletions, prereq: plan.prereq, blockers: plan.blockers }
      }
      throw reject('请提交制作目标 goal')
    },
    validateConfirm,
    async preview(projectId, id, sessionId, input = {}) {
      const run = await owned(projectId, id, sessionId), root = await projects.read(projectId)
      if (!run.request.goal) throw reject('该任务未使用目标规划')
      const policy = { ...run.policy, authorizePrereq: input.authorizePrereq || [] }
      if (!Array.isArray(policy.authorizePrereq) || policy.authorizePrereq.some(key => typeof key !== 'string')) throw reject('前置授权无效')
      const previewRoot = prospectiveRoot(root, run.request)
      const plan = input.goal ? continuationPlan(root, run, planRun(plannerView(previewRoot, run.episodeId), normalizeRunGoal(input.goal), plannerPolicy(previewRoot, policy, run.episodeId))) : goalPlan(root, run, policy)
      if (policy.authorizePrereq.some(key => !plan.prereq.some(item => item.key === key))) throw reject('前置授权无效')
      if (run.status === 'draft' && !input.goal) await runStore(home, projectId).update(id, current => { current.preview = { deletions: plan.deletions, blockers: plan.blockers, projectRevision: root.revision }; return current })
      return { run: publicRun(run), goal: input.goal || run.goal, steps: plan.steps, prereq: plan.prereq, deletions: plan.deletions, blockers: plan.blockers, projectRevision: root.revision }
    },
    async confirm(projectId, id, sessionId, options = {}) {
      const { run, deletions } = await validateConfirm(projectId, id, sessionId, options)
      if (run.preview.blockers?.length) throw reject(run.preview.blockers.map(item => item.message).join('；'), 'RUN_BLOCKED')
      if (run.request.goal) {
        const root = await projects.read(projectId), policy = { ...run.policy, authorizePrereq: options.authorizePrereq || [] }
        const plan = goalPlan(root, run, policy)
        const added = plan.deletions.filter(item => !deletions.some(prior => JSON.stringify(item) === JSON.stringify(prior)))
        if (added.length) throw Object.assign(reject('授权前置增加了删除范围，请先重新预览', 'DELETIONS_PENDING'), { deletions: plan.deletions })
        await runStore(home, projectId).update(id, current => { current.policy = policy; current.prereq.authorized = [...policy.authorizePrereq]; current.steps = plan.steps.map(step => ({ status: 'pending', prompts: [], responses: [], artifacts: [], startedAt: null, endedAt: null, ...step })); return current })
      }
      if (run.request.newEpisode) await projects.save(projectId, root => {
        if (root.episodes.some(item => item.id === run.episodeId)) return root
        if (root.episodes.length !== run.request.newEpisode.number - 1) throw reject('剧集顺序已变化，请重新预览', 'RUN_PREVIEW_CHANGED')
        return { ...root, episodes: [episodeModel(run.episodeId, { durationSeconds: run.request.newEpisode.durationSeconds }), ...root.episodes] }
      })
      if (deletions.length) await runStore(home, projectId).update(id, current => { current.events.push({ at: new Date().toISOString(), type: 'deletions_confirmed', actor: 'user', payload: { deletions } }); return current })
      return publicRun(await engine.confirm(projectId, id))
    },
    async get(projectId, id, sessionId) { return publicRun(await owned(projectId, id, sessionId)) },
    async list(projectId, sessionId, filter = {}) {
      await requireProject(projectId, sessionId)
      return (await runStore(home, projectId).list()).filter(run =>
        runInScope(run, filter.episodeId) &&
        (!filter.status || run.status === filter.status) && (!filter.initiator || run.initiator === filter.initiator) &&
        (!filter.target || run.steps.some(step => runTargetMatches(step.target, filter.target))))
        .sort(orderRuns).map(summary)
    },
    async records(projectId, id, stepId, kind, sessionId) { await owned(projectId, id, sessionId); return runStore(home, projectId).records(id, stepId, kind) },
    async projectEvents(projectId, sessionId) { await requireProject(projectId, sessionId); return (await historyStore(home, projectId).list('events')).sort((a, b) => b.at.localeCompare(a.at)) },
    async pause(projectId, id, sessionId) { await owned(projectId, id, sessionId); return publicRun(await engine.pause(projectId, id)) },
    async cancel(projectId, id, sessionId, stepId) { await owned(projectId, id, sessionId); return publicRun(await engine.cancel(projectId, id, stepId)) },
    async resume(projectId, id, sessionId, options, initiator = 'panel') {
      const { action, stepId } = options
      const run = await owned(projectId, id, sessionId)
      if (action === 'authorize') {
        const reason = run.pause?.reasons.find(item => item.stepId === stepId && item.actions.includes('authorize'))
        if (!reason || !Array.isArray(options.authorizePrereq) || !options.authorizePrereq.length) throw reject('请选择要授权的前置')
        const root = await projects.read(projectId), authorized = [...new Set([...(run.policy.authorizePrereq || []), ...options.authorizePrereq])]
        if (authorized.some(key => !run.prereq.required.some(entry => entry.key === key))) throw reject('前置授权无效')
        const policy = { ...run.policy, authorizePrereq: authorized }, plan = goalPlan(root, run, policy)
        if (plan.deletions.length && options.confirmDelete !== true) throw Object.assign(reject('请先确认前置删除清单', 'DELETIONS_PENDING'), { deletions: plan.deletions })
        await runStore(home, projectId).update(id, current => { current.policy = policy; current.prereq.authorized = authorized; current.events.push({ at: new Date().toISOString(), type: 'prereq_authorized', actor: 'user', payload: { authorized } }); return current })
        if (options.authorizePrereq.includes('project-summary@all') && run.steps.some(step => step.target === 'project-summary' && ['done', 'skipped'].includes(step.status))) {
          const prerequisite = planRun(root, { to: 'project-summary', mode: 'regenerate' }, plannerPolicy(root, policy, run.episodeId))
          return publicRun(await engine.insert(projectId, id, { targets: ['project-summary'], steps: prerequisite.steps, type: 'prereq_authorized' }))
        }
        return publicRun(await engine.amend(projectId, id, { steps: plan.steps }))
      }
      if (action === 'override') {
        if (initiator !== 'panel') throw Object.assign(new Error('人工放行仅限面板'), { status: 403 })
        const step = run.steps.find(item => item.id === stepId)
        if (!run.pause?.reasons.some(reason => reason.stepId === stepId && reason.actions.includes('override'))) throw reject('当前步骤不能人工放行')
        const root = await projects.read(projectId), view = run.episodeId ? materialize(root, run.episodeId) : root
        const manual = run.pause.reasons.some(reason => reason.stepId === stepId && reason.code === 'manual_edit')
        const validate = value => {
          if (!manual) return overrideBlocker(value, step.target)
          const copy = structuredClone(value), node = targetNode(copy, step.target)
          if (!node) return '目标不存在'
          node.check.passed = false
          return overrideBlocker(copy, step.target)
        }
        const blocked = validate(view)
        if (blocked) throw reject(blocked)
        const release = occupy(home, { projectId, episodeId: run.episodeId, action: 'review-override', lock: step.scope }, { id: stepId, label: '人工放行' })
        try {
          await projects.save(projectId, current => {
            const view = run.episodeId ? materialize(current, run.episodeId) : current, reason = validate(view)
            if (reason) throw reject(reason)
            const nodes = manual ? [[step.target, targetNode(view, step.target)]] : overrideNodes(view, step.target)
            for (const [, node] of nodes) markPassed(node, { override: { at: new Date().toISOString(), actor: 'human', reasons: node.check.failures } })
            return run.episodeId ? foldEpisode(current, run.episodeId, view) : current
          })
        } finally { release() }
      }
      if (action === 'cancel-branch') return this.cancel(projectId, id, sessionId, stepId)
      return publicRun(await engine.resume(projectId, id, { action, stepId }))
    },
    async amend(projectId, id, sessionId, input) {
      const run = await owned(projectId, id, sessionId)
      if (input.goal && run.request.goal) {
        const root = await projects.read(projectId), goal = normalizeRunGoal(input.goal)
        if (input.projectRevision !== undefined && input.projectRevision !== root.revision) throw reject('资料已变化，请重新预览', 'RUN_PREVIEW_CHANGED')
        const plan = continuationPlan(root, run, planRun(plannerView(root, run.episodeId), goal, plannerPolicy(root, { ...run.policy, authorizePrereq: input.authorizePrereq || [] }, run.episodeId)))
        if (plan.blockers.length) throw reject(plan.blockers.map(item => item.message).join('；'), 'RUN_BLOCKED')
        if (plan.deletions.length && input.confirmDelete !== true) throw Object.assign(reject('请先确认删除清单', 'DELETIONS_PENDING'), { deletions: plan.deletions })
        if (run.status === 'draft') {
          const goals = [...(run.request.goals || [run.request.goal]), goal]
          const combined = mergeRunPlans(goals.map(value => planRun(plannerView(root, run.episodeId), value, plannerPolicy(root, run.policy, run.episodeId))))
          return publicRun(await runStore(home, projectId).update(id, current => { current.request.goals = goals; current.preview = { deletions: combined.deletions, blockers: combined.blockers }; current.prereq.required = combined.prereq; current.steps = combined.steps.map(step => ({ status: 'pending', prompts: [], responses: [], artifacts: [], startedAt: null, endedAt: null, ...step })); return current }))
        }
        await runStore(home, projectId).update(id, current => { current.request.goals = [...(current.request.goals || [current.request.goal]), goal]; current.prereq.required = [...current.prereq.required, ...plan.prereq.filter(entry => !current.prereq.required.some(prior => prior.key === entry.key))]; current.events.push({ at: new Date().toISOString(), type: 'deletions_confirmed', actor: 'user', payload: { deletions: plan.deletions } }); return current })
        if (goal.feedback || goal.mode === 'regenerate') {
          const targets = [...new Set(plan.steps.map(step => step.target))]
          return publicRun(await engine.insert(projectId, id, { targets, steps: plan.steps, type: goal.feedback ? 'feedback' : 'regenerate' }))
        }
        return publicRun(await engine.amend(projectId, id, { steps: plan.steps }))
      }
      throw reject('并入任务需要制作目标 goal')
    },
    async recover(projectId) { watch(projectId); return engine.recover(projectId) },
    async contentChanged(operation, before) {
      const deletions = operationDeletes(before, operation), root = await projects.read(before.id)
      const baseTarget = { 'outline-text': 'outline', 'character-text': 'characters', 'scene-text': 'scenes', 'prop-text': 'props', source: 'summary', 'episode-edit': 'summary' }[operation.action] || (operation.action === 'storyboard-text' ? `storyboard:${operation.track}` : ['import-image', 'use-asset', 'clear-image', 'confirm-image'].includes(operation.action) ? `image:${operation.itemId || before.episodes.find(episode => episode.id === operation.episodeId)?.pendingImages?.[operation.draftId]?.itemId}` : null)
      let continuation = null, summaryOwned = false
      for (const run of await runStore(home, before.id).list()) {
        if (!run.request?.goal || !['running', 'paused'].includes(run.status)) continue
        if (['discard-image', 'entry-image-discard'].includes(operation.action)) {
          const episode = before.episodes.find(item => item.id === operation.episodeId), draft = episode?.pendingImages?.[operation.draftId]
          const target = `image:${draft?.itemId || operation.variantId}`
          if (run.steps.some(step => step.target === target && step.kind === 'wait_confirm') && (run.episodeId === operation.episodeId || !run.episodeId)) await runStore(home, before.id).update(run.id, current => { current.events.push({ at: new Date().toISOString(), type: 'image_discarded', actor: 'human', payload: { target } }); return current })
        }
        const view = plannerView(root, run.episodeId), affected = deletions.filter(item => item.episodeId === run.episodeId).map(item => item.track ? `${['video', 'tailFrame'].includes(item.kind) ? 'film' : item.kind}:${item.track}` : item.kind)
        const changed = baseTarget && run.episodeId === operation.episodeId ? baseTarget : null
        const covered = new Set(run.steps.filter(step => !['superseded', 'cancelled'].includes(step.status)).map(step => step.target))
        const targets = [...new Set(affected.filter(target => covered.has(target)))]
        if (!targets.length && !(changed && covered.has(changed))) continue
        if (changed === 'summary') summaryOwned = true
        const manualTarget = changed || `image:${operation.itemId || operation.variantId || ''}`
        const text = ['summary', 'outline', 'characters', 'scenes', 'props', 'storyboard'].includes(manualTarget.split(':')[0])
        const plans = []
        if (manualTarget === 'summary') plans.push(planRun(view, { to: 'script-sync' }, plannerPolicy(root, run.policy, run.episodeId)))
        for (const target of targets) {
          if (target === manualTarget || target.startsWith('storyboard:') && targets.includes(target.replace('storyboard:', 'film:'))) continue
          plans.push(planRun(view, goalForRunTarget(target, { mode: 'generate' }), plannerPolicy(root, run.policy, run.episodeId)))
        }
        const combined = mergeRunPlans(plans), kept = combined.steps.filter(step => covered.has(step.target) || manualTarget === 'summary' && step.target === 'script'), keptIds = new Set(kept.map(step => step.id))
        for (const step of kept) { step.after = step.after.filter(id => keptIds.has(id)); step.origin = 'cascade' }
        const manual = { id: 'manual-edit', key: `manual_edit@${manualTarget}`, target: manualTarget, kind: 'manual_edit', scope: operation.lock === 'project' ? 'project' : 'episode', queue: null, actor: 'human', after: [], status: 'done', endedAt: new Date().toISOString(), input: { saved: true } }
        const inserted = [manual]
        let parent = manual.id
        if (text) {
          let review
          if (manualTarget.startsWith('storyboard:')) review = { id: 'manual-review', key: `re_review@${manualTarget}`, target: manualTarget, kind: 're_review', scope: 'episode', queue: 'text', actor: 'model', input: { manualReview: true, taskType: 'storyboard-prompt', operation: { action: 'shot-storyboard', track: operation.track } } }
          else {
            review = planRun(view, goalForRunTarget(manualTarget, { mode: 'review' }), plannerPolicy(root, run.policy, run.episodeId)).steps[0]
            review = { ...review, id: 'manual-review', key: `re_review@${manualTarget}`, kind: 're_review' }
          }
          inserted.push({ ...review, status: 'paused', after: [manual.id] }); parent = 'manual-review'
        }
        for (const step of kept) if (!step.after.length) step.after = [parent]
        inserted.push(...kept)
        const updated = await engine.insert(before.id, run.id, { targets: [...targets, ...(changed ? [changed] : [])], steps: inserted, type: 'manual_edit' })
        const savedManual = updated.steps.findLast(step => step.kind === 'manual_edit' && step.target === manualTarget)
        if (text) {
          const selected = updated.steps.findLast(step => step.kind === 're_review' && step.target === manualTarget)
          await runStore(home, before.id).update(run.id, current => { current.pause ||= { reasons: [] }; current.pause.reasons.push({ code: 'manual_edit', stepId: selected.id, target: manualTarget, message: '编辑已保存，选择复审或直接通过后继续', actions: ['review', 'override', 'cancel-branch'] }); return current })
          const node = targetNode(view, manualTarget)
          if (node) {
            const artifact = await runStore(home, before.id).record(run.id, savedManual.id, 'artifacts', { target: manualTarget, content: node.items || node.content, published: true, episodeId: run.episodeId, version: (node.source?.version || 0) + 1 })
            await projects.save(before.id, current => {
              const view = plannerView(current, run.episodeId), target = targetNode(view, manualTarget)
              if (target) { markPendingReview(target); target.source = { artifactId: artifact.id, runId: run.id, stepId: savedManual.id, target: manualTarget, version: artifact.version, reviewPassed: null } }
              return run.episodeId ? foldEpisode(current, run.episodeId, view) : view
            })
          }
          continuation = { runId: run.id, stepId: selected.id, target: manualTarget }
        }
      }
      if (!summaryOwned && ['source', 'episode-add', 'episode-edit', 'episode-delete'].includes(operation.action)) {
        const changedEpisode = root.episodes.find(episode => episode.summary.revision !== before.episodes.find(item => item.id === episode.id)?.summary.revision)
        const deleted = root.scriptPendingDeletes.find(item => !before.scriptPendingDeletes.some(prior => prior.episodeId === item.episodeId))
        const episodeId = changedEpisode?.id || deleted?.episodeId
        if (episodeId && operation.sessionId) {
          const planned = await this.plan({ projectId: root.id, episodeId, goal: { to: 'script-sync' } }, operation.sessionId)
          if (planned.amend) await this.amend(root.id, planned.run.id, operation.sessionId, { goal: { to: 'script-sync' }, confirmDelete: true })
          else await this.confirm(root.id, planned.run.id, operation.sessionId)
          continuation = { runId: planned.run.id, kind: 'sync' }
        }
      }
      return continuation
    },
    drain: () => engine.drain(),
    async dispose() { for (const unsubscribe of subscriptions.values()) unsubscribe(); subscriptions.clear(); await engine.dispose() },
  }
}
