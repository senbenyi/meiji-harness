// 唯一调度循环：持久化先于执行；锁保留到本地执行器真正退出。
// 阶段 1A 只提供注入接口，生产入口在业务单步执行器接通后统一切换。
import { randomUUID } from 'node:crypto'
import { runStore } from '../../data/run-store.js'
import { createQueue, defaultConcurrency } from '../tasks/task-queue.js'
import { defaults } from '../../../models/model-config.js'
import { RUN_SCHEMA, StepStatus, readySteps, isRunEnded, downstreamSteps } from '../../../shared/run-model.js'

const now = () => new Date().toISOString()
const event = (run, type, actor, stepIds, payload) => run.events.push({ at: now(), type, actor, ...(stepIds ? { stepIds } : {}), ...(payload ? { payload } : {}) })
const error = message => Object.assign(new Error(message), { status: 409, code: 'RUN_ACTION_INVALID' })
const makeStep = spec => ({ id: randomUUID(), key: `${spec.kind}@${spec.target}`, target: null, after: [], queue: null, actor: 'program', status: 'pending', scope: 'project', origin: 'plan', prompts: [], responses: [], artifacts: [], startedAt: null, endedAt: null, ...structuredClone(spec) })
const clearReason = (run, id) => {
  if (run.pause) run.pause.reasons = run.pause.reasons.filter(reason => reason.stepId !== id)
  if (!run.pause?.reasons.length) run.pause = null
}
const pauseStep = (run, step, code, message, actions) => {
  step.status = StepStatus.PAUSED; step.error = message; step.endedAt = now()
  clearReason(run, step.id)
  run.pause ||= { reasons: [] }
  run.pause.reasons.push({ code, stepId: step.id, target: step.target, message, actions })
  event(run, 'paused', 'engine', [step.id], { code, message })
}
const rewire = (run, previous, next) => {
  for (const step of run.steps) if (step.id !== next.id) step.after = step.after.map(id => id === previous.id ? next.id : id)
}

export function createRunEngine({ home, execute, beforeStep = async () => null, limitOf = async kind => (await defaults()).concurrency?.[kind] ?? defaultConcurrency[kind], queue: suppliedQueue, onChange = () => {}, canAcquireStep = () => true, acquireStep = () => () => {} }) {
  if (typeof execute !== 'function') throw new Error('必须提供单步执行器')
  const queue = suppliedQueue || createQueue(limitOf), known = new Map(), active = new Map(), failures = []
  let scheduling = Promise.resolve(), disposed = false
  const key = (projectId, id) => `${projectId}:${id}`
  const track = (projectId, id) => { known.set(key(projectId, id), { projectId, id }) }
  const publish = run => { try { onChange(structuredClone(run)) } catch { /* 观察者不能破坏已提交任务。 */ } return run }
  const update = async (projectId, id, change) => publish(await runStore(home, projectId).update(id, change))
  const mutable = run => { if (isRunEnded(run)) throw error('任务已经结束'); return run }
  const overlap = (run, step, held) => run.projectId === held.run.projectId && (step.scope === 'project' || held.step.scope === 'project' || run.episodeId === held.run.episodeId && (!step.target || !held.step.target || step.target === held.step.target))

  const finish = async (run, selected, result, failure) => update(run.projectId, run.id, current => {
    const step = current.steps.find(item => item.id === selected.id)
    // 暂停协作式收尾；取消/作废后晚到的结果不能把步骤恢复成 done。
    if (step.status !== 'running' || isRunEnded(current)) return current
    if (!failure && ['review', 're_review'].includes(step.kind) && typeof result?.passed !== 'boolean') failure = new Error('审核步骤缺少有效的 passed 结论')
    if (failure) pauseStep(current, step, 'step_failed', failure.message || String(failure), ['retry', 'cancel-branch'])
    else {
      step.output = result ?? null; step.endedAt = now(); step.error = null
      if (step.kind === 'wait_script_confirm') { current.affectedEpisodes = result?.affectedEpisodes || []; current.optionalGoals = result?.optionalGoals || [] }
      if (['review', 're_review'].includes(step.kind) && result?.passed === false) {
        const round = step.round || 0
        if (round < (step.input?.manualReview ? 0 : current.policy.maxRevisions)) {
          step.status = StepStatus.DONE
          const revise = makeStep({ kind: 'revise', target: step.target, scope: step.scope, queue: step.queue, actor: step.actor, origin: 'review-fail', round: round + 1, input: { ...step.input, reviewedStepId: step.id, baseStepId: step.input?.baseStepId || step.after[0] || null, feedback: result }, after: [step.id] })
          const review = makeStep({ kind: 're_review', target: step.target, scope: step.scope, queue: step.queue, actor: step.actor, origin: 'review-fail', round: round + 1, input: structuredClone(step.input), after: [revise.id] })
          rewire(current, step, review)
          current.steps.push(revise, review)
        } else pauseStep(current, step, 'review_exhausted', '审核未通过，已用尽自动修订次数', ['feedback', 'edit', 'override', 'regenerate', 'cancel-branch'])
      } else step.status = StepStatus.DONE
      if (step.kind === 'expand' && Array.isArray(result?.steps)) {
        const ids = new Map(result.steps.map(item => [item.id, randomUUID()]))
        const incoming = result.steps.map(item => makeStep({ ...item, id: ids.get(item.id), origin: 'expand', after: item.after.length ? item.after.map(parent => ids.get(parent)) : [step.id] }))
        const tails = incoming.filter(item => !incoming.some(child => child.after.includes(item.id))).map(item => item.id)
        for (const dependent of current.steps) if (dependent.id !== step.id && dependent.after.includes(step.id)) dependent.after = [...new Set(dependent.after.flatMap(parent => parent === step.id && tails.length ? tails : [parent]))]
        current.steps.push(...incoming)
        event(current, 'expanded', 'engine', incoming.map(item => item.id))
      }
    }
    return current
  })
  const dispatch = (run, step) => {
    let release = () => {}
    const id = key(run.projectId, step.id), controller = new AbortController()
    const held = { run, step, controller, promise: null }
    active.set(id, held)
    const job = async () => {
      // ready 期间允许编辑；出队后重新获取实际执行锁，冲突就释放槽位等待事件唤醒。
      try { release = acquireStep(run, step) } catch (cause) { if (cause.code === 'OPERATION_BUSY') return; throw cause }
      let claimed = false
      const current = await update(run.projectId, run.id, value => {
        const target = value.steps.find(item => item.id === step.id)
        if (readySteps(value).some(item => item.id === step.id)) { target.status = StepStatus.RUNNING; target.startedAt = now(); target.endedAt = null; claimed = true }
        return value
      })
      const started = current.steps.find(item => item.id === step.id)
      if (!claimed) return
      let gate
      try { gate = await beforeStep(current, started) } catch (cause) { await finish(current, started, null, cause); return }
      if (gate?.pause || gate?.skip) {
        await update(run.projectId, run.id, value => {
          const target = value.steps.find(item => item.id === step.id)
          if (target.status !== StepStatus.RUNNING) return value
          if (gate.pause) pauseStep(value, target, gate.pause.code, gate.pause.message, gate.pause.actions || ['cancel-branch'])
          else { target.status = StepStatus.SKIPPED; target.endedAt = now() }
          return value
        })
        return
      }
      if (controller.signal.aborted) { await finish(current, started, null, controller.signal.reason); return }
      let result, failure
      try {
        result = await execute(structuredClone(current), structuredClone(started), {
          signal: controller.signal,
          record: (kind, value) => runStore(home, run.projectId).record(run.id, step.id, kind, value),
        })
      } catch (cause) { failure = cause }
      await finish(current, started, result, failure)
    }
    held.promise = (step.queue ? queue.run(step.queue, controller.signal, job, null, id) : job())
      .catch(cause => { if (!controller.signal.aborted) failures.push(cause) })
      .finally(() => { release(); active.delete(id); kick() })
  }
  const pump = async () => {
    if (disposed) return
    for (const { projectId, id } of known.values()) {
      let run
      try { run = await runStore(home, projectId).read(id) } catch (cause) { if (cause.status === 404) { known.delete(key(projectId, id)); continue } throw cause }
      if (isRunEnded(run)) continue
      // 前置与人工确认由项目事件唤醒；执行错误和用户暂停仍需明确动作。
      for (const reason of run.pause?.reasons || []) {
        if (!['prereq_required', 'wait_confirm', 'wait_script_confirm', 'script_pending'].includes(reason.code)) continue
        const selected = run.steps.find(step => step.id === reason.stepId)
        const gate = await beforeStep(run, selected)
        if (!gate?.pause) run = await update(projectId, id, current => {
          const step = current.steps.find(item => item.id === selected.id)
          if (step.status === StepStatus.PAUSED) { step.status = StepStatus.PENDING; step.error = null; step.endedAt = null; clearReason(current, step.id); event(current, 'unblocked', 'engine', [step.id]) }
          return current
        })
      }
      const ready = readySteps(run)
      if (ready.some(step => step.status === 'pending')) run = await update(projectId, id, current => {
        for (const step of readySteps(current)) step.status = StepStatus.READY
        return current
      })
      for (const step of readySteps(run)) {
        if (active.has(key(projectId, step.id)) || [...active.values()].some(held => overlap(run, step, held)) || !canAcquireStep(run, step)) continue
        dispatch(run, step)
      }
    }
  }
  function kick() {
    scheduling = scheduling.then(pump).catch(cause => { failures.push(cause) })
  }
  const schedule = run => { track(run.projectId, run.id); kick(); return run }

  return {
    async create(spec) {
      if (disposed) throw error('引擎已经关闭')
      const run = {
        schemaVersion: RUN_SCHEMA, id: randomUUID(), projectId: spec.projectId, episodeId: spec.episodeId ?? null,
        initiator: spec.initiator || 'panel', sessionId: spec.sessionId || null, goal: structuredClone(spec.goal || {}),
        policy: { review: true, maxRevisions: 2, ...spec.policy }, prereq: structuredClone(spec.prereq || { required: [], authorized: [] }), affectedEpisodes: structuredClone(spec.affectedEpisodes || []),
        pause: null, steps: (spec.steps || []).map(makeStep), request: structuredClone(spec.request || null), preview: structuredClone(spec.preview || null), events: [], createdAt: now(), startedAt: null, endedAt: null, revision: 0,
      }
      if (!Number.isInteger(run.policy.maxRevisions) || run.policy.maxRevisions < 0 || run.policy.maxRevisions > 2) throw error('修订上限必须为 0～2')
      event(run, 'created', 'user')
      const stored = await runStore(home, run.projectId).create(run)
      track(stored.projectId, stored.id)
      return publish(stored)
    },
    get: (projectId, id) => runStore(home, projectId).read(id),
    wake: () => kick(),
    async confirm(projectId, id) {
      if (disposed) throw error('引擎已经关闭')
      return schedule(await update(projectId, id, run => {
        mutable(run)
        if (!run.events.some(item => item.type === 'confirmed')) { run.startedAt = now(); event(run, 'confirmed', 'user') }
        return run
      }))
    },
    async amend(projectId, id, { goal, steps = [] }) {
      return schedule(await update(projectId, id, run => {
        mutable(run)
        const existing = new Map(run.steps.filter(step => !['superseded', 'cancelled'].includes(step.status)).map(step => [step.key, step]))
        const incoming = steps.map(makeStep), ids = new Map(), added = []
        for (const step of incoming) {
          const found = existing.get(step.key)
          ids.set(step.id, found?.id || step.id)
          if (!found) { existing.set(step.key, step); added.push(step) }
        }
        for (const step of added) step.after = step.after.map(parent => ids.get(parent) || parent)
        run.steps.push(...added)
        if (goal) run.goal = { ...run.goal, ...structuredClone(goal) }
        event(run, 'goal_amended', 'user', added.map(step => step.id))
        return run
      }))
    },
    async pause(projectId, id) {
      const run = await update(projectId, id, current => {
        mutable(current)
        if (!current.events.some(item => item.type === 'confirmed')) throw error('草稿不能暂停')
        current.pause ||= { reasons: [] }
        if (!current.pause.reasons.some(item => item.code === 'user_paused')) {
          current.pause.reasons.push({ code: 'user_paused', message: '用户暂停任务', actions: ['resume'] })
          event(current, 'paused', 'user')
        }
        return current
      })
      return run
    },
    async insert(projectId, id, { targets, steps, type = 'feedback', goal }) {
      const updated = await update(projectId, id, run => {
        mutable(run)
        const selected = new Set(targets), replaced = run.steps.filter(step => selected.has(step.target) && !['superseded', 'cancelled'].includes(step.status))
        const oldIds = new Set(replaced.map(step => step.id))
        const ids = new Map(steps.map(step => [step.id, randomUUID()]))
        const incoming = steps.map(step => makeStep({ ...step, id: ids.get(step.id), origin: step.origin === 'cascade' ? 'cascade' : type === 'manual_edit' ? 'manual' : type === 'invalidate' ? 'cascade' : 'user-feedback', after: step.after.map(parent => ids.get(parent) || parent) }))
        const tails = incoming.filter(step => !incoming.some(child => child.after.includes(step.id))).map(step => step.id)
        const targetTails = target => incoming.filter(step => step.target === target && !incoming.some(child => child.target === target && child.after.includes(step.id))).map(step => step.id)
        if (!tails.length) throw error('没有可插入的步骤')
        for (const step of replaced) { step.status = StepStatus.SUPERSEDED; step.endedAt ||= now(); clearReason(run, step.id) }
        for (const step of run.steps) if (!oldIds.has(step.id) && !['superseded', 'cancelled', 'done', 'skipped'].includes(step.status)) step.after = [...new Set(step.after.flatMap(parent => { if (!oldIds.has(parent)) return [parent]; const replacements = targetTails(replaced.find(old => old.id === parent).target); return replacements.length ? replacements : tails }))]
        run.steps.push(...incoming)
        if (goal) run.goal = { ...run.goal, ...structuredClone(goal) }
        event(run, type, 'user', incoming.map(step => step.id), { targets })
        return run
      })
      for (const held of active.values()) if (held.run.id === id && held.run.projectId === projectId && updated.steps.find(step => step.id === held.step.id)?.status === 'superseded') held.controller.abort(error('步骤已作废'))
      return schedule(updated)
    },
    async resume(projectId, id, { action, stepId } = {}) {
      if (disposed) throw error('引擎已经关闭')
      return schedule(await update(projectId, id, run => {
        mutable(run)
        const reason = run.pause?.reasons.find(item => stepId ? item.stepId === stepId : item.code === 'user_paused')
        if (!reason?.actions.includes(action)) throw error('当前暂停原因不允许该动作')
        if (action === 'resume') run.pause.reasons = run.pause.reasons.filter(item => item !== reason)
        else {
          const step = run.steps.find(item => item.id === stepId)
          if (action === 'retry' || action === 'review') { step.status = StepStatus.PENDING; step.error = null; step.endedAt = null }
          else if (action === 'override') {
            const override = makeStep({ kind: 'override', target: step.target, scope: step.scope, actor: 'human', origin: 'manual', status: 'done', endedAt: now() })
            step.status = StepStatus.DONE; rewire(run, step, override); run.steps.push(override)
          } else throw error('此动作须通过对应业务入口处理')
          clearReason(run, stepId)
        }
        if (!run.pause?.reasons.length) run.pause = null
        event(run, 'resumed', 'user', stepId ? [stepId] : undefined, { action })
        return run
      }))
    },
    async cancel(projectId, id, stepId) {
      const run = await update(projectId, id, current => {
        mutable(current)
        if (stepId && !current.steps.some(step => step.id === stepId)) throw error('步骤不存在')
        const steps = stepId ? downstreamSteps(current.steps, stepId) : current.steps
        for (const step of steps) {
          if (!['done', 'skipped', 'superseded', 'cancelled'].includes(step.status)) { step.status = StepStatus.CANCELLED; step.endedAt = now() }
          clearReason(current, step.id)
        }
        if (!stepId) current.pause = null
        event(current, 'cancelled', 'user', stepId ? steps.map(step => step.id) : undefined)
        return current
      })
      const cancelled = new Set(run.steps.filter(step => step.status === 'cancelled').map(step => step.id))
      for (const held of active.values()) if (held.run.projectId === projectId && held.run.id === id && (cancelled.has(held.step.id) || !stepId)) held.controller.abort(error('任务已取消'))
      return schedule(run)
    },
    async recover(projectId) {
      if ([...active.values()].some(held => held.run.projectId === projectId)) throw error('执行期间不能恢复项目任务')
      const store = runStore(home, projectId), runs = await store.interrupt()
      for (const run of await store.list()) if (!isRunEnded(run)) track(projectId, run.id)
      kick()
      return runs.map(publish)
    },
    // 等到本地执行/排队和调度全部收尾；暂停的阻断分支不会导致等待空转。
    async drain() {
      for (;;) {
        await scheduling
        const pending = [...active.values()].map(held => held.promise)
        if (!pending.length) break
        await Promise.all(pending)
      }
      if (failures.length) throw failures.shift()
    },
    async dispose() {
      disposed = true
      for (const held of active.values()) held.controller.abort(error('引擎已关闭'))
      await this.drain()
      // 未运行的 ready 保持可恢复；已运行的执行器退出后会记录失败暂停。
    },
  }
}
