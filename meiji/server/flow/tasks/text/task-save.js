import { runNode } from '../../../runtime/step-execution.js'
export async function runSave(context, definition) {
  const planned = definition.plan?.(context.project, context.operation)
  if (planned) return definition.run(context)
  const node = definition.step?.(context.operation, context.project) || { kind: 'save', target: null }
  return runNode(node.kind, () => definition.run(context), { target: node.target })
}
