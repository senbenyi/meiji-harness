import { createHash } from 'node:crypto'
import { validateWorkflowBindings } from '../capabilities/workflow-bindings.js'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function list(value) { return Array.isArray(value) ? value : value ? [value] : [] }

export function workflowHash(workflow) {
  return createHash('sha256').update(canonical(workflow)).digest('hex')
}

export function buildWorkflowRequest({ workflow, bindings, snapshot, mediaInputs = [] }) {
  const validation = validateWorkflowBindings(bindings, workflow)
  if (!validation.ok) throw new Error(validation.errors.join('; '))
  const graph = structuredClone(workflow)
  const values = {
    positivePrompt: snapshot?.prompt,
    negativePrompt: snapshot?.negativePrompt,
    width: snapshot?.parameters?.width,
    height: snapshot?.parameters?.height,
    frames: snapshot?.parameters?.frames ?? snapshot?.parameters?.length,
    seed: snapshot?.parameters?.seed,
  }
  for (const [semantic, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue
    for (const binding of list(bindings[semantic])) {
      const nodeId = String(binding.nodeId ?? binding.node)
      const input = binding.input ?? binding.field
      graph[nodeId].inputs[input] = value
    }
  }
  for (const binding of list(bindings.referenceImages)) {
    const value = mediaInputs[Number(binding.slot) || 0]
    if (value === undefined) continue
    const nodeId = String(binding.nodeId ?? binding.node)
    graph[nodeId].inputs[binding.input ?? binding.field] = value
  }
  return { graph, workflowHash: workflowHash(graph) }
}
