// 任务执行生命周期：入队/启动、步骤和尝试执行、结束/取消；持久化交给 data。
import { randomUUID } from 'node:crypto'
import { assertDrama } from '../../shared/drama-model.js'
import { StepStatus, deriveTaskStatus } from '../../shared/task-nodes.js'
import { isRevisionKind } from '../../shared/task-nodes.js'
import { readProjectFile } from '../data/project-files.js'
import { loadSkillSet } from '../data/skill-store.js'
import { notifyProject } from '../data/project-events.js'
import { TASK_SCHEMA, recordStore, writeNodes } from '../data/task-store.js'
import { addBaselines } from '../data/content-records.js'
import { executionContext, liveTasks as live, usedSkills } from './task-context.js'
import { recorded, createNode, finalizeNodes, taskIdOfNode, unprepare } from './task-state.js'

const now = () => new Date().toISOString()
const stages = { 'episode-generate': 'summary', 'episode-edit': 'summary', 'episode-add': 'summary', source: 'summary', outline: 'story', 'outline-text': 'story', characters: 'story', scenes: 'story', 'scene-text': 'story', 'character-text': 'story', shots: 'shots', 'revise-shot': 'shots', seconds: 'seconds', 'shot-seconds': 'seconds', storyboard: 'storyboard', 'shot-storyboard': 'storyboard', 'storyboard-text': 'storyboard', film: 'film', films: 'film', assemble: 'assembly' }

// 任务开始（或进入队列）时写入记录与完整步骤计划。plan 为 [{ kind, target }]。
// meta.operationId：所属操作记录（history/operations）的 id。
export async function createTaskRecord(home, operation, id, plan, meta = {}) {
  if (!recorded(operation)) return null
  const actor = meta.actor || 'model'
  const nodes = (plan?.length ? plan : [{ kind: 'execute' }]).map(step => createNode(step, actor))
  const record = { schemaVersion: TASK_SCHEMA, id, operationId: meta.operationId || null, callId: operation.callId || null, type: meta.type || operation.action, label: meta.label || null, targets: meta.targets || null, projectId: operation.projectId, episodeId: operation.episodeId || null,
    action: operation.action, source: operation.origin || 'api', actor, sessionId: operation.sessionId || null,
    mode: operation.draft ? 'draft' : operation.mode || operation.generationMode || (operation.draft ? 'draft' : meta.actor === 'human' ? 'edit' : 'generate'), requirements: operation.requirements || '', opinion: operation.review || operation.instruction || '',
    target: meta.targets?.[0] ?? null, maxRevisions: meta.maxRevisions ?? 0, status: deriveTaskStatus(nodes), startedAt: now(), endedAt: null, nodes, artifacts: [], latestOutputs: [], error: null }
  await recordStore(home, operation.projectId).update('tasks', id, record)
  live.set(id, record)
  notifyProject(home, operation.projectId)
  return record
}

// 任务出队开始执行：复用入队时写入的记录（没有则新建）；步骤仍全部未执行时按最新内容重写计划
// （排队期间镜头数等可能变化），并把第一个步骤记为「准备中」的执行中，直到执行器真正开始某个步骤。
export async function beginTask(home, operation, id, plan, meta = {}) {
  if (!recorded(operation)) return null
  const store = recordStore(home, operation.projectId)
  let record = null
  try { record = await store.read('tasks', id) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!record || record.endedAt) record = await createTaskRecord(home, operation, id, plan, meta)
  if (record.nodes.every(step => step.status === StepStatus.PENDING)) {
    record = await store.update('tasks', id, task => {
      const nodes = plan?.length ? plan.map(step => createNode(step, task.actor)) : task.nodes
      Object.assign(nodes[0], { status: StepStatus.RUNNING, preparing: true, startedAt: now() })
      return { ...task, nodes, status: deriveTaskStatus(nodes) }
    })
    live.set(id, record)
    notifyProject(home, operation.projectId)
  }
  return record
}

// 每个任务独立建立执行上下文。
export async function startExecution(home, operation, id, plan, meta = {}) {
  if (!recorded(operation)) return null
  const stage = meta.stage || stages[operation.action]
  const store = recordStore(home, operation.projectId)
  const record = await beginTask(home, operation, id, plan, meta)
  const nodes = [...record.nodes]
  const project = operation.projectId ? assertDrama(await readProjectFile(home, operation.projectId)) : null
  const baselines = new Map()
  if (project) await addBaselines(store, project, operation, stage, baselines)
  // 任务开始时固定技能组合（内置 + 基础 + 本剧），同一任务内的全部请求（含嵌套子操作）使用同一份。
  const skillSet = await loadSkillSet(home, project?.skills)
  skillSet.nodeSupplements = structuredClone(Object.fromEntries((project?.episodes || []).map(episode => [episode.id, episode.supplementalSkills || {}])))
  return { store, home, taskId: id, operationId: meta.operationId, taskType: meta.type, actor: meta.actor, projectId: operation.projectId, operation, stage, baselines, outputs: [], nodes, signal: null, nodeId: null, scope: 'root', skillSet, skills: new Map() }
}

// 请求前保存精确提示词；步骤只带引用，任务列表不携带大段文本、密钥或参考图。
export async function recordNodePrompt({ kind, messages, prompt }) {
  const context = executionContext.getStore()
  const step = context?.nodes.find(item => item.id === context.nodeId)
  if (!step) return
  const content = messages ? { messages: messages.map(({ role, content }) => ({ role, content })) } : { prompt }
  const id = randomUUID()
  const snapshot = { id, taskId: taskIdOfNode(context, step.id), nodeId: step.id, episodeId: context.operation.episodeId || null,
    kind, createdAt: now(), ...structuredClone(content) }
  await context.store.update('prompts', id, snapshot)
  step.prompts = [...(step.prompts || []), { id, kind, createdAt: snapshot.createdAt }]
  await writeNodes(context)
}

export async function recordNodeResponse(data) {
  const context = executionContext.getStore()
  const step = context?.nodes.find(item => item.id === context.nodeId)
  if (!step) return
  try {
    const id = randomUUID()
    const snapshot = { ...data, id, taskId: taskIdOfNode(context, step.id), nodeId: step.id,
      episodeId: context.operation.episodeId || null, createdAt: now() }
    await context.store.update('responses', id, snapshot)
    step.responses = [...(step.responses || []), { id, fn: data.fn, createdAt: snapshot.createdAt }]
    await writeNodes(context)
  } catch { /* 诊断记录失败不改变网关请求的结果。 */ }
}

export async function endExecution(context, error, signal) {
  if (!context) return
  finalizeNodes(context.nodes, error, signal)
  const primary = await context.store.update('tasks', context.taskId, task => ({ ...task, ...usedSkills(context), nodes: context.nodes,
    status: deriveTaskStatus(context.nodes), latestOutputs: context.outputs, endedAt: now(), error: context.nodes.find(node => node.error)?.error || error?.message || null }))
  live.delete(context.taskId)
  notifyProject(context.home, context.projectId)
  return primary
}

// 执行一个步骤：按种类与目标对应到第一个未执行的计划步骤，否则追加（修订/复审为动态节点，其余标记为计划外）。
// 结果带 check 时记录审核结论；内容校验不通过记为「完成 + 不通过」；中止记为已取消，其他错误记为失败。
export async function runNode(kind, run, detail = {}) {
  const context = executionContext.getStore()
  if (!context) return run()
  const target = detail.target ?? null
  let step = context.nodes.find(item => (item.status === StepStatus.PENDING || item.preparing) && item.kind === kind && (item.target ?? null) === target && (item.phase ?? null) === (detail.phase ?? null))
  // 开始的不是准备中的步骤时，准备中的步骤恢复为未执行。
  for (const item of context.nodes) if (item.preparing && item !== step) unprepare(item)
  if (step) delete step.preparing
  if (!step) {
    // 修订与复审是按自审结论动态追加的节点（带轮次），不属于计划外步骤。
    const dynamic = isRevisionKind(kind)
    step = { ...createNode({ kind, target, label: detail.label, phase: detail.phase }, context.nodes[0]?.actor || 'model'), ...(dynamic ? { round: detail.round ?? null } : { unplanned: true }) }
    context.nodes.push(step)
  } else if (detail.label) step.label = detail.label
  if (isRevisionKind(kind) && detail.round != null) step.round = detail.round
  const outputs = target ? context.outputs.filter(item => item.target === target) : context.outputs
  const baselines = [...context.baselines.entries()].filter(([key]) => !target || key.endsWith(':' + target)).map(([, value]) => value)
  Object.assign(step, { status: StepStatus.RUNNING, scope: context.scope, startedAt: now(), inputs: [...new Set((outputs.length ? outputs : baselines).map(item => item.artifactId))], ...(detail.remoteId ? { remoteId: detail.remoteId } : {}) })
  await writeNodes(context)
  return executionContext.run({ ...context, nodeId: step.id }, async () => {
    try {
      const result = await run()
      Object.assign(step, { status: StepStatus.COMPLETED, endedAt: now(), ...(result?.check ? { verdict: result.check.passed ? 'pass' : 'fail', reasons: result.check.failures || [] } : {}) })
      await writeNodes(context)
      return result
    } catch (error) {
      if (error.code === 'CONTENT_CHECK_FAILED' && !context.signal?.aborted) Object.assign(step, { status: StepStatus.COMPLETED, verdict: 'fail', reasons: [error.message], endedAt: now() })
      else Object.assign(step, { status: context.signal?.aborted ? StepStatus.CANCELLED : StepStatus.FAILED, error: error.message, ...(error.apiFailure ? { apiFailure: true } : {}), endedAt: now() })
      await writeNodes(context)
      throw error
    }
  })
}

// 同一步骤内的一次尝试（如每秒指令续传），记录在步骤的 attempts 中，不拆成独立步骤。
export async function nodeAttempt(label, run) {
  const context = executionContext.getStore()
  const step = context?.nodes.find(item => item.id === context.nodeId)
  if (!step) return run()
  const attempt = { label, status: StepStatus.RUNNING, startedAt: now(), endedAt: null }
  step.attempts = [...(step.attempts || []), attempt]
  await writeNodes(context)
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
    await writeNodes(context)
  }
}
