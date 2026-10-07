import { bundledProductionPipelines, loadProductionOutputSchema } from './pipeline-registry.js'

export class ProductionPipelineCompiler {
  constructor(pipeline) {
    this.pipeline = pipeline
    this.nodes = new Map(pipeline.nodes.map((node) => [node.id, node]))
    this.phases = new Map(pipeline.phases.map((phase) => [phase.id, phase.title]))
  }

  node(id, kind = 'agent') {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`production pipeline node not found: ${id}`)
    if (kind && node.kind !== kind) throw new Error(`production pipeline node ${id} must be ${kind}`)
    return node
  }

  task(nodeId, { id, label, dependencies = [], scopeId } = {}) {
    const node = this.node(nodeId, null)
    return {
      id,
      kind: node.kind === 'barrier' ? 'novel-barrier' : 'novel-text',
      ...(scopeId ? { scopeId } : {}),
      dependencies,
      input: {
        pipelineId: this.pipeline.id,
        pipelineVersion: this.pipeline.version,
        pipelineNodeId: node.id,
        role: node.role,
        label,
        phase: this.phases.get(node.phase),
        handler: node.id,
        concurrency: node.concurrency || 1,
        ...(node.outputSchema ? { outputSchema: node.outputSchema } : {}),
        validators: structuredClone(node.validators || []),
        ...(node.retry ? { retry: structuredClone(node.retry) } : {}),
        commit: structuredClone(node.commit),
      },
    }
  }

  request(nodeId, { prompt, schema, ...request }) {
    const node = this.node(nodeId)
    const constraints = node.prompt.constraints.map((item) => `- ${item}`).join('\n')
    return {
      ...request,
      pipelineId: this.pipeline.id,
      pipelineVersion: this.pipeline.version,
      pipelineNodeId: node.id,
      role: node.role,
      phase: this.phases.get(node.phase),
      schema: schema || loadProductionOutputSchema(node.outputSchema),
      retry: structuredClone(node.retry),
      prompt: `目标：${node.prompt.objective}\n硬约束：\n${constraints}\n动态输入：\n${prompt}`,
    }
  }

  batches(nodeId, values) {
    const size = this.node(nodeId).concurrency
    const batches = []
    for (let offset = 0; offset < values.length; offset += size) batches.push(values.slice(offset, offset + size))
    return batches
  }

  async commit(nodeId, payload, submit) {
    const node = this.node(nodeId, null)
    if (node.commit.handler === 'complete-production-task') return payload
    if (node.commit.handler === 'submit-development-proposal') return submit(node.commit.kind, payload, {
      pipelineId: this.pipeline.id,
      pipelineVersion: this.pipeline.version,
      pipelineNodeId: node.id,
    })
    throw new Error(`unsupported production commit handler: ${node.commit.handler}`)
  }
}

export function bundledProductionPipelineCompiler(id = 'novel-to-drama-text') {
  const registry = bundledProductionPipelines()
  if (registry.errors.length) throw new Error(`production pipeline registry invalid: ${registry.errors.join('; ')}`)
  const pipeline = registry.byId[id]
  if (!pipeline) throw new Error(`production pipeline not found: ${id}`)
  return new ProductionPipelineCompiler(pipeline)
}
