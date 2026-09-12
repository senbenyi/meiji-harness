import { readFile } from 'node:fs/promises'
import { mediaReference } from '../media/http-media.js'

// A small override of the existing H3 graph; submission/recovery stays shared.
export async function buildPreviewGraph(plan, jobId, bundle) {
  const config = JSON.parse(await readFile(new URL('./profiles/preview.json', import.meta.url), 'utf8'))
  const graph = structuredClone(bundle.graph)
  const width = Math.ceil(config.width / 32) * 32, height = Math.ceil(config.height / 32) * 32
  const requestedFrames = Math.max(5, Math.round(config.requested_seconds * config.fps))
  const frames = requestedFrames + (5 - requestedFrames % 17 + 17) % 17
  Object.assign(graph.n105_104.inputs, { prompt: plan.prompt, width, height, length: frames })
  graph.n105_9.inputs.steps = config.steps
  if (plan.mode === 'i2va') {
    graph.preview_image = { class_type: 'LoadImage', inputs: { image: mediaReference(plan.first_frame, ['.png', '.jpg', '.jpeg', '.webp']).name } }
    graph.n105_104.inputs.first_frame = ['preview_image', 0]
  }
  Object.assign(graph.n126.inputs, { images: ['n105_10', 0], frame_rate: config.fps, filename_prefix: `elysium/${jobId}/preview/final` })
  const needed = new Set()
  function visit(id) {
    if (needed.has(id)) return
    needed.add(id)
    for (const value of Object.values(graph[id].inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && graph[value[0]]) visit(value[0])
    }
  }
  visit('n126')
  return { graph: Object.fromEntries(Object.entries(graph).filter(([id]) => needed.has(id))),
    mode: plan.mode, workflowName: `preview-${plan.mode}`, outputNode: 'n126', source: bundle.source,
    specification: { backend: config.backend, width, height, frames, fps: config.fps, seconds: frames / config.fps,
      requested_seconds: config.requested_seconds, steps: config.steps, audio: 'joint-generation-and-decoding', interpolation: false } }
}
