// 职责：按视频模式选择模板并应用用户绑定生成执行图。
import { readFile } from 'node:fs/promises'

import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { buildProfileGraph } from './profile.js'

export async function loadVideoTemplate(mode) {
  return JSON.parse(await readFile(new URL(`./templates/${mode}.json`, import.meta.url), 'utf8'))
}

export async function buildVideoGraph(plan, jobId) {
  if (['preview', 'regular'].includes(plan.profile)) return buildProfileGraph(plan, jobId, await loadVideoTemplate('t2va'))
  const bundle = await loadVideoTemplate(plan.mode)
  const graph = structuredClone(bundle.graph)
  for (const binding of bundle.bindings.prompt) graph[binding.node].inputs[binding.input] = plan.prompt
  for (const [name, binding] of Object.entries(bundle.bindings.media)) {
    graph[binding.node].inputs[binding.input] = mediaReference(plan[name], ['.png', '.jpg', '.jpeg', '.webp']).name
  }
  const output = bundle.bindings.output
  graph[output.node].inputs[output.input] = `elysium/${jobId}/${plan.mode}/final`
  return { graph, profile: plan.profile || 'standard', mode: plan.mode,
    workflowName: plan.profile === 'high-quality' ? `high-quality-${plan.mode}` : plan.mode, workflow: bundle.workflow,
    outputNode: output.node, source: bundle.source }
}
