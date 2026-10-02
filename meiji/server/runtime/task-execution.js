// 任务执行生命周期：入队/启动、步骤和尝试执行、结束/取消；持久化交给 data。
import { randomUUID } from 'node:crypto'
import { assertDrama } from '../../shared/drama-model.js'
import { StepStatus, deriveTaskStatus } from '../../shared/task-steps.js'
import { readProjectFile } from '../data/project-files.js'
import { loadSkillSet } from '../data/skill-store.js'
import { notifyProject } from '../data/project-events.js'
import { TASK_SCHEMA, recordStore, writeSteps } from '../data/task-store.js'
import { addBaselines } from '../data/content-records.js'
import { executionContext, liveTasks as live, usedSkills } from './task-context.js'
import { manualActions, humanActions, recorded, createStep, finalizeSteps, unprepare } from './task-state.js'

const now = () => new Date().toISOString()
const stages = { 'episode-generate': 'summary', 'episode-edit': 'summary', 'episode-add': 'summary', source: 'summary', outline: 'story', 'outline-text': 'story', characters: 'story', scenes: 'story', 'scene-text': 'story', 'character-text': 'story', shots: 'shots', 'revise-shot': 'shots', seconds: 'seconds', 'shot-seconds': 'seconds', storyboard: 'storyboard', 'shot-storyboard': 'storyboard', 'shot-boards': 'storyboard', 'storyboard-text': 'storyboard', film: 'film', films: 'film', assemble: 'assembly' }

// 任务开始（或进入队列）时写入记录与完整步骤计划。plan 为 [{ kind, target }]。
export async function createTaskRecord(home, operation, id, plan) {
  if (!recorded(operation)) return null
  const actor = humanActions.has(operation.action) ? 'human' : 'model'
  const steps = (plan?.length ? plan : [{ kind: 'execute' }]).map(step => createStep(step, actor))
  const record = { schemaVersion: TASK_SCHEMA, id, projectId: operation.projectId, episodeId: operation.episodeId || null,
    action: operation.action, source: operation.origin || 'api', actor, sessionId: operation.sessionId || null,
    mode: operation.mode || operation.generationMode || (manualActions.has(operation.action) ? 'edit' : 'generate'), requirements: operation.requirements || '', opinion: operation.review || operation.instruction || '',
    status: deriveTaskStatus(steps), startedAt: now(), endedAt: null, steps, artifacts: [], latestOutputs: [], error: null }
  await recordStore(home, operation.projectId).update('tasks', id, record)
  live.set(id, record)
  notifyProject(home, operation.projectId)
  return record
}

// 任务出队开始执行：复用入队时写入的记录（没有则新建）；步骤仍全部未执行时按最新内容重写计划
// （排队期间镜头数等可能变化），并把第一个步骤记为「准备中」的执行中，直到执行器真正开始某个步骤。
export async function beginTask(home, operation, id, plan) {
  if (!recorded(operation)) return null
  const store = recordStore(home, operation.projectId)
  let record = null
  try { record = await store.read('tasks', id) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!record || record.endedAt) record = await createTaskRecord(home, operation, id, plan)
  if (record.steps.every(step => step.status === StepStatus.PENDING)) {
    record = await store.update('tasks', id, task => {
      const steps = plan?.length ? plan.map(step => createStep(step, task.actor)) : task.steps
      Object.assign(steps[0], { status: StepStatus.RUNNING, preparing: true, startedAt: now() })
      return { ...task, steps, status: deriveTaskStatus(steps) }
    })
    live.set(id, record)
    notifyProject(home, operation.projectId)
  }
  return record
}

// 进入执行。嵌套操作（逐镜成片调用的子操作）复用外层任务的上下文，步骤写入同一个任务，按 scope 区分。
export async function startExecution(home, operation, id, plan) {
  if (!recorded(operation)) return null
  const parent = executionContext.getStore()
  const stage = stages[operation.action]
  if (parent && parent.taskId === id) {
    const project = assertDrama(await readProjectFile(home, operation.projectId))
    await addBaselines(parent.store, project, operation, stage, parent.baselines)
    return { ...parent, operation, stage, nested: true, scope: randomUUID() }
  }
  const store = recordStore(home, operation.projectId)
  const record = await beginTask(home, operation, id, plan)
  const project = assertDrama(await readProjectFile(home, operation.projectId))
  const baselines = new Map()
  await addBaselines(store, project, operation, stage, baselines)
  // 任务开始时固定技能组合（内置 + 基础 + 本剧），同一任务内的全部请求（含嵌套子操作）使用同一份。
  const skillSet = await loadSkillSet(home, project.skills)
  skillSet.nodeSupplements = structuredClone(Object.fromEntries(project.episodes.map(episode => [episode.id, episode.supplementalSkills || {}])))
  return { store, home, taskId: id, projectId: operation.projectId, operation, stage, baselines, outputs: [], steps: record.steps, signal: null, stepId: null, scope: 'root', skillSet, skills: new Map() }
}

// 请求前保存精确提示词；步骤只带引用，任务列表不携带大段文本、密钥或参考图。
export async function recordStepPrompt({ kind, messages, prompt }) {
  const context = executionContext.getStore()
  const step = context?.steps.find(item => item.id === context.stepId)
  if (!step) return
  const content = messages ? { messages: messages.map(({ role, content }) => ({ role, content })) } : { prompt }
  const id = randomUUID()
  const snapshot = { id, taskId: context.taskId, stepId: step.id, episodeId: context.operation.episodeId || null,
    kind, createdAt: now(), ...structuredClone(content) }
  await context.store.update('prompts', id, snapshot)
  step.prompts = [...(step.prompts || []), { id, kind, createdAt: snapshot.createdAt }]
  await writeSteps(context)
}

export async function endExecution(context, error, signal) {
  if (!context || context.nested) return
  finalizeSteps(context.steps, error, signal)
  const record = await context.store.update('tasks', context.taskId, task => ({ ...task, ...usedSkills(context), steps: context.steps, status: deriveTaskStatus(context.steps), latestOutputs: context.outputs, endedAt: now(),
    error: error?.message || context.steps.find(step => step.error)?.error || null }))
  live.delete(context.taskId)
  notifyProject(context.home, context.projectId)
  return record
}

// 从未进入执行的任务（排队中被取消或启动前出错）直接落定。
export async function abandonTask(home, projectId, id, error, signal) {
  let record = null
  try { record = await recordStore(home, projectId).read('tasks', id) } catch (reason) { if (reason.code === 'ENOENT') return null; throw reason }
  if (record.endedAt) return record
  const steps = finalizeSteps(structuredClone(record.steps), error, signal)
  const saved = await recordStore(home, projectId).update('tasks', id, task => ({ ...task, steps, status: deriveTaskStatus(steps), endedAt: now(), error: error?.message || null }))
  live.delete(id)
  notifyProject(home, projectId)
  return saved
}

// 执行一个步骤：按种类与目标对应到第一个未执行的计划步骤，否则追加。
// 结果带 check 时记录审核结论；内容校验不通过记为「完成 + 不通过」；中止记为已取消，其他错误记为失败。
export async function runStep(kind, run, detail = {}) {
  const context = executionContext.getStore()
  if (!context) return run()
  const target = detail.target ?? null
  let step = context.steps.find(item => (item.status === StepStatus.PENDING || item.preparing) && item.kind === kind && (item.target ?? null) === target && (item.phase ?? null) === (detail.phase ?? null))
  // 开始的不是准备中的步骤时，准备中的步骤恢复为未执行。
  for (const item of context.steps) if (item.preparing && item !== step) unprepare(item)
  if (step) delete step.preparing
  if (!step) {
    step = { ...createStep({ kind, target, label: detail.label, phase: detail.phase }, context.steps[0]?.actor || 'model'), unplanned: true }
    context.steps.push(step)
  } else if (detail.label) step.label = detail.label
  const outputs = target ? context.outputs.filter(item => item.target === target) : context.outputs
  const baselines = [...context.baselines.entries()].filter(([key]) => !target || key.endsWith(':' + target)).map(([, value]) => value)
  Object.assign(step, { status: StepStatus.RUNNING, scope: context.scope, startedAt: now(), inputs: [...new Set((outputs.length ? outputs : baselines).map(item => item.artifactId))], ...(detail.remoteId ? { remoteId: detail.remoteId } : {}) })
  await writeSteps(context)
  return executionContext.run({ ...context, stepId: step.id }, async () => {
    try {
      const result = await run()
      Object.assign(step, { status: StepStatus.COMPLETED, endedAt: now(), ...(result?.check ? { verdict: result.check.passed ? 'pass' : 'fail', reasons: result.check.failures || [] } : {}) })
      await writeSteps(context)
      return result
    } catch (error) {
      if (error.code === 'CONTENT_CHECK_FAILED' && !context.signal?.aborted) Object.assign(step, { status: StepStatus.COMPLETED, verdict: 'fail', reasons: [error.message], endedAt: now() })
      else Object.assign(step, { status: context.signal?.aborted ? StepStatus.CANCELLED : StepStatus.FAILED, error: error.message, ...(error.apiFailure ? { apiFailure: true } : {}), endedAt: now() })
      await writeSteps(context)
      throw error
    }
  })
}

// 同一步骤内的一次尝试（如每秒指令续传），记录在步骤的 attempts 中，不拆成独立步骤。
export async function stepAttempt(label, run) {
  const context = executionContext.getStore()
  const step = context?.steps.find(item => item.id === context.stepId)
  if (!step) return run()
  const attempt = { label, status: StepStatus.RUNNING, startedAt: now(), endedAt: null }
  step.attempts = [...(step.attempts || []), attempt]
  await writeSteps(context)
  try {
    const result = await run()
    attempt.status = StepStatus.COMPLETED
    return result
  } catch (error) {
    attempt.status = StepStatus.FAILED
    attempt.error = error.message
    throw error
  } finally {
    attempt.endedAt = now()
    await writeSteps(context)
  }
}
