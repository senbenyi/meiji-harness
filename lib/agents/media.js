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
  const entity = task.kind === 'render-reference'
    ? project[task.input.preparationKind === 'character' ? 'characters' : 'locations'][task.scopeId]
    : project.shots[task.scopeId]
  const assetIds = delivery
    ? (task.input.nodes || []).flatMap((id) => {
      const shot = project.shots[id]
      return [shot?.approvedAssetId || shot?.assetIds?.at(-1)]
    })
    : [...(entity?.referenceBindings || []).map((binding) => binding.assetId), ...(task.kind === 'render-shot' ? [entity?.storyboardAssetId] : [])]
  const input = {
    projectId: project.id, taskId: task.id, kind: task.kind, scopeId: task.scopeId,
    productionSpec: project.productionSpec, source: project.storyBible?.proposalId,
    visualStyle: project.storyBible?.visualStyle,
    assetVersions: assetIds.filter(Boolean).map((id) => ({ id, contentHash: project.assets?.[id]?.contentHash, status: project.assets?.[id]?.status })),
    entity: entity && { id: entity.id, name: entity.name, description: entity.description, visualDescription: entity.visualDescription, shotDescription: entity.shotDescription, prompt: entity.prompt, duration: entity.duration, audioDialogue: entity.audioDialogue, audioNotes: entity.audioNotes, referenceBindings: entity.referenceBindings, storyboardAssetId: task.kind === 'render-shot' ? entity.storyboardAssetId : undefined, scriptVersion: entity.scriptVersion },
    nodes: task.input.nodes,
    assets: delivery ? (task.input.nodes || []).map((id) => ({ id, shotIds: project.episodes[task.input.episodeId]?.shotIds, approvedAssetId: project.shots[id]?.approvedAssetId })) : undefined,
    strategy: task.input.strategy,
  }
  const inputSignature = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  let plan = task.checkpoint?.agentPlan
  if (plan && plan.inputSignature !== inputSignature) throw new Error('专业代理方案已过期，请由主 Agent 重新分派当前任务')
  if (!plan) {
    const properties = {
      taskId: { type: 'string' }, inputSignature: { type: 'string' },
      decision: { type: 'string', enum: ['ready', 'rework'] }, reason: { type: 'string' },
      ...(delivery ? { nodes: { type: 'array', items: { type: 'string' } }, strategy: { type: 'string', enum: ['preserve', 'strict'] } } : { prompt: { type: 'string' } }),
    }
    const [result] = await runWorkflow([{
      label: task.id, role, phase: `${productionRole(role).name}制作`,
      schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
      prompt: `只处理此任务，返回 taskId=${task.id}、inputSignature=${inputSignature}。可执行则 decision=ready；输入不足或需上游修改则 decision=rework 并说明原因。${delivery ? '完整保留 nodes 顺序和 strategy，不得增加、遗漏或重排。当前只能计划原声保留的拼接交付，不得声称已完成字幕、混音或视觉质量检查。' : '提供具体生成 prompt，忠实使用已定设定、画面、动作及对白；不得改变时长、参考绑定或故事。不能凭文字声称看过媒体。'}\n输入：${JSON.stringify(input)}`,
    }])
    if (result?.label !== task.id || result.error || !result.value) throw new Error(result?.error || '专业代理未返回当前任务的制作方案')
    plan = result.value
  }
  if (plan.taskId !== task.id || plan.inputSignature !== inputSignature) throw new Error('专业代理返回了错误的任务或输入版本')
  if (plan.decision !== 'ready') throw new Error(`${productionRole(role).name} subagent 请求返工：${plan.reason || '制作方案未通过'}`)
  if (delivery) {
    if (JSON.stringify(plan.nodes) !== JSON.stringify(task.input.nodes) || plan.strategy !== task.input.strategy) throw new Error('成片 subagent 不得遗漏、重排镜头或更改指定合成策略')
  } else if (typeof plan.prompt !== 'string' || !plan.prompt.trim()) throw new Error('专业代理缺少媒体生成提示词')
  if (!task.checkpoint?.agentPlan) await checkpoint('agent-plan', { agentPlan: plan })
  return { ...task, input: { ...task.input, ...(delivery ? {} : { prompt: plan.prompt, agentPrompt: plan.prompt }) } }
}
