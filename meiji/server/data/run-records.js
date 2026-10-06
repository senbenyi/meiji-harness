import { notifyProject } from './project-events.js'
export async function writeStep(context) {
  const node = context.nodes[0]
  const run = await context.store.updateStep({ attempts: structuredClone(node.attempts), inputs: [...node.inputs], outputs: [...node.outputs], saved: Boolean(node.saved), skills: [...(context.skills?.values() || [])] })
  notifyProject(context.home, context.projectId, run.revision)
  return run
}
