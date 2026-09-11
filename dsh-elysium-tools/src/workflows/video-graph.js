import { readFile } from 'node:fs/promises'

import { mediaReference } from '../media/http-media.js'

export async function loadVideoTemplate(mode) {
  return JSON.parse(await readFile(new URL(`./templates/runpod/${mode}.json`, import.meta.url), 'utf8'))
}

export async function buildVideoGraph(plan, jobId) {
  const bundle = await loadVideoTemplate(plan.mode)
  const graph = structuredClone(bundle.graph)
  for (const binding of bundle.bindings.prompt) graph[binding.node].inputs[binding.input] = plan.prompt
  for (const [name, binding] of Object.entries(bundle.bindings.media)) {
    graph[binding.node].inputs[binding.input] = mediaReference(plan[name], ['.png', '.jpg', '.jpeg', '.webp']).name
  }
  const output = bundle.bindings.output
  graph[output.node].inputs[output.input] = `elysium/${jobId}/${plan.mode}/final`
  return { graph, mode: plan.mode, workflowName: plan.mode, workflow: bundle.workflow,
    outputNode: output.node, source: bundle.source }
}
