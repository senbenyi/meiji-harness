// 阶段 1B 的业务注册表适配；阶段 2 由纯 goal 规划器替代。
import { randomUUID } from 'node:crypto'
import { planTasks, validateOperation } from '../operations/operation-registry.js'
import { operationScope } from '../../../shared/operation-conflicts.js'
import { linkedOperationCard } from '../../data/project-files.js'

export async function planOperationRun(home, operation) {
  const op = structuredClone(operation), originalOrigin = op.origin
  // Run 执行完整目标，旧会话“只执行一节点”的限制不再参与展开。
  op.origin = 'panel'
  const definition = validateOperation(op)
  if (definition.kind === 'direct' && op.action !== 'assemble') throw Object.assign(new Error('即时编辑不创建制作任务'), { status: 400 })
  const tasks = await planTasks(home, op), steps = [], branchTails = new Map()
  let tail = null
  for (const task of tasks) {
    const track = task.operation.track
    let after = op.action === 'film' ? branchTails.get(track) || null : tail
    const base = { ...task.operation, origin: originalOrigin || 'panel', sessionId: operation.sessionId }
    const scope = operationScope({ ...op, lock: definition.lock || (task.definition.stage === 'project' || linkedOperationCard(home, base) ? 'project' : undefined) }).lock
    const kinds = task.type === 'video' ? (op.parts === 'tail' ? ['tail'] : ['video', 'tail']) : task.type === 'storyboard-prompt' ? ['storyboard'] : task.queue === 'image' ? ['image'] : task.type === 'save' ? ['assemble'] : op.mode === 'review' ? ['review'] : [op.generationMode === 'modify' || op.mode === 'modify' ? 'revise' : 'generate', 'review']
    for (const kind of kinds) {
      const id = randomUUID(), target = task.target
      const inputOperation = { ...base, ...(kind === 'tail' ? { parts: 'tail' } : kind === 'video' ? { parts: 'video', runVideoOnly: true } : {}) }
      steps.push({ id, key: `${kind}@${target}`, kind, target, label: `${task.label}·${kind}`, scope,
        queue: ['tail', 'storyboard', 'assemble'].includes(kind) ? null : task.queue,
        actor: ['tail', 'storyboard', 'assemble'].includes(kind) ? 'program' : task.actor,
        origin: 'plan', after: after ? [after] : [], input: { taskType: task.type, operation: inputOperation, ...(task.type === 'save' ? { directAction: op.action } : {}) } })
      after = id
    }
    if (op.action === 'film') branchTails.set(track, after)
    else tail = after
  }
  return { episodeId: op.episodeId || null, steps }
}
