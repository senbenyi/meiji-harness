import { createHash } from 'node:crypto'
import { taskAgentRole, productionRole } from './roles.js'
import { entityFor, assertGenerationReady } from '../prompts/specification.js'

/** Build a scoped media assignment; worker retains all writes and execution authority. */
export async function prepareMediaTask({ project, task, checkpoint, runWorkflow }) {
  if (!['render-reference', 'render-storyboard', 'render-shot', 'concat-video', 'deliver-drama'].includes(task.kind)) return task
  const role = taskAgentRole(task)
  const delivery = role === 'delivery'
  if (!delivery) {
    const entity = task.kind === 'render-reference' ? entityFor(project, task.input.preparationKind, task.scopeId) : project.shots[task.scopeId]
    const specification = assertGenerationReady(project, entity, task.kind === 'render-shot' ? 'video' : 'image')
    // Regeneration consumes the approved authored prompt; it never silently rewrites it.
    return { ...task, input: { ...task.input, prompt: specification.prompt, negativePrompt: specification.negativePrompt } }
  }
  const assets = (task.input.nodes || []).map((id) => {
    const assetId = project.shots[id]?.approvedAssetId || project.shots[id]?.assetIds?.at(-1)
    const asset = project.assets?.[assetId]
    const node = project.legacyCanvas?.nodes?.find((item) => item.id === id)
    return { id, shotIds: project.episodes[task.input.episodeId]?.shotIds, approvedAssetId: assetId,
      media: asset?.logicalKey || node?.media, contentHash: asset?.contentHash || node?.params?.contentHash,
      status: asset?.status || node?.status, duration: node?.params?.actualDuration, sourceNodeIds: node?.params?.sources }
  })
  const input = {
    projectId: project.id, taskId: task.id, kind: task.kind, scopeId: task.scopeId,
    productionSpec: project.productionSpec, source: project.storyBible?.proposalId,
    visualStyle: project.storyBible?.visualStyle,
    assetVersions: assets.map((asset) => ({ id: asset.approvedAssetId || asset.id, contentHash: asset.contentHash, status: asset.status })),
    nodes: task.input.nodes,
    assets,
    strategy: task.input.strategy,
  }
  const inputSignature = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  let plan = task.checkpoint?.agentPlan
  if (plan && plan.inputSignature !== inputSignature) throw new Error('专业代理方案已过期，请由主 Agent 重新分派当前任务')
  if (!plan) {
    const properties = {
      taskId: { type: 'string' }, inputSignature: { type: 'string' },
      decision: { type: 'string', enum: ['ready', 'rework'] }, reason: { type: 'string' },
      nodes: { type: 'array', items: { type: 'string' } }, strategy: { type: 'string', enum: ['preserve', 'strict'] },
    }
    const [result] = await runWorkflow([{
      label: task.id, role, phase: `${productionRole(role).name}制作`,
      schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
      prompt: `只处理此任务，返回 taskId=${task.id}、inputSignature=${inputSignature}。可执行则 decision=ready；输入不足或需上游修改则 decision=rework 并说明原因。完整保留 nodes 顺序和 strategy，不得增加、遗漏或重排。当前只能计划原声保留的拼接交付，不得声称已完成字幕、混音或视觉质量检查。\n输入：${JSON.stringify(input)}`,
    }])
    if (result?.label !== task.id || result.error || !result.value) throw new Error(result?.error || '专业代理未返回当前任务的制作方案')
    plan = result.value
  }
  if (plan.taskId !== task.id || plan.inputSignature !== inputSignature) throw new Error('专业代理返回了错误的任务或输入版本')
  if (plan.decision !== 'ready') throw new Error(`${productionRole(role).name} subagent 请求返工：${plan.reason || '制作方案未通过'}`)
  if (JSON.stringify(plan.nodes) !== JSON.stringify(task.input.nodes) || plan.strategy !== task.input.strategy) throw new Error('成片 subagent 不得遗漏、重排镜头或更改指定合成策略')
  if (!task.checkpoint?.agentPlan) await checkpoint('agent-plan', { agentPlan: plan })
  return task
}
