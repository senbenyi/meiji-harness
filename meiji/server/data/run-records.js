import { notifyProject } from './project-events.js'
export async function writeStep(context) {
  const node = context.nodes[0]
  if (!context.store.updateStep) {
    if (context.store.update) await context.store.update('nodes', node?.id || context.nodeId || 'node', { ...node, prompts: node?.prompts || [], responses: node?.responses || [] })
    return node
  }
  const run = await context.store.updateStep({ attempts: structuredClone(node.attempts), inputs: [...node.inputs], outputs: [...node.outputs], saved: Boolean(node.saved), skills: [...(context.skills?.values() || [])] })
  notifyProject(context.home, context.projectId, run.revision)
  return run
}
