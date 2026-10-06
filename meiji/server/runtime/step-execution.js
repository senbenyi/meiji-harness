// Run 单步的精确请求、响应及内部尝试；不建立第二层任务记录。
import { randomUUID } from 'node:crypto'
import { executionContext } from './task-context.js'
import { writeStep } from '../data/run-records.js'
import { StepStatus } from '../../shared/run-model.js'
const now = () => new Date().toISOString()
const recordIdentity = context => ({ runId: context.runId, stepId: context.stepId })
export async function recordNodePrompt({ kind, messages, prompt }) {
  const context = executionContext.getStore()
  const step = context?.nodes.find(item => item.id === context.nodeId)
  if (!step) return
  const content = messages ? { messages: messages.map(({ role, content }) => ({ role, content })) } : { prompt }
  const id = randomUUID()
  const snapshot = { id, ...recordIdentity(context), episodeId: context.operation.episodeId || null,
    kind, createdAt: now(), ...structuredClone(content) }
  await context.store.update('prompts', id, snapshot)
  step.prompts = [...(step.prompts || []), { id, kind, createdAt: snapshot.createdAt }]
  await writeStep(context)
}

export async function recordNodeResponse(data) {
  const context = executionContext.getStore()
  const step = context?.nodes.find(item => item.id === context.nodeId)
  if (!step) return
  try {
    const id = randomUUID()
    const snapshot = { ...data, id, ...recordIdentity(context),
      episodeId: context.operation.episodeId || null, createdAt: now() }
    await context.store.update('responses', id, snapshot)
    step.responses = [...(step.responses || []), { id, fn: data.fn, createdAt: snapshot.createdAt }]
    await writeStep(context)
  } catch { /* 诊断记录失败不改变网关请求的结果。 */ }
}

export async function runNode(kind, run, detail = {}) {
  const context = executionContext.getStore()
  if (!context) return run()
  return nodeAttempt(detail.label || kind, async () => { const result = await run(); if (result?.review) executionContext.getStore().verdict = result.review; return result }, { kind, ...detail })
}
export async function nodeAttempt(label, run, detail = {}) {
  const context = executionContext.getStore()
  const step = context?.nodes.find(item => item.id === context.nodeId)
  if (!step) return run()
  const attempt = { ...detail, label, status: StepStatus.RUNNING, startedAt: now(), endedAt: null }
  step.attempts = [...(step.attempts || []), attempt]
  await writeStep(context)
  try {
    const result = await run()
    if (result?.check) { attempt.verdict = result.check.passed ? 'pass' : 'fail'; attempt.reasons = result.check.failures || [] }
    attempt.status = StepStatus.DONE
    return result
  } catch (error) {
    attempt.status = StepStatus.PAUSED
    attempt.error = error.message
    throw error
  } finally {
    attempt.endedAt = now()
    await writeStep(context)
  }
}
