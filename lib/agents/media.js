import { taskAgentRole } from './roles.js'
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
  // Concatenation and delivery are deterministic transport steps. Asking an LLM
  // to echo task ids, hashes and node order adds a probabilistic failure point
  // without making a creative decision; the worker/handlers own those invariants.
  return task
}
