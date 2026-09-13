// 职责：加载视频档位配置，并编译预览与常规工作流。
import { readFile } from 'node:fs/promises'
import { mediaReference } from '../comfyui/media-reference.js'

// A small override of the existing H3 graph; submission/recovery stays shared.
export async function buildProfileGraph(plan, jobId, bundle) {
  const profile = plan.profile === 'regular' ? 'regular' : 'preview'
  const config = JSON.parse(await readFile(new URL(`./profiles/${profile}.json`, import.meta.url), 'utf8'))
  const lowResolution = plan.preview_variant === 'low-resolution'
  if (lowResolution) Object.assign(config, JSON.parse(await readFile(new URL('./profiles/preview-low-resolution.json', import.meta.url), 'utf8')))
  const profileName = lowResolution ? 'preview-low-resolution' : profile
  const graph = structuredClone(bundle.graph)
  const width = Math.ceil(config.width / 32) * 32, height = Math.ceil(config.height / 32) * 32
  const requestedSeconds = profile === 'regular' ? plan.duration_seconds ?? config.requested_seconds : config.requested_seconds
  const requestedFrames = Math.max(5, Math.round(requestedSeconds * config.fps))
  const frames = requestedFrames + (5 - requestedFrames % 17 + 17) % 17
  Object.assign(graph.n105_104.inputs, { prompt: plan.prompt, width, height, length: frames })
  graph.n105_9.inputs.steps = config.steps
  if (plan.mode === 'i2va') {
    graph.preview_image = { class_type: 'LoadImage', inputs: { image: mediaReference(plan.first_frame, ['.png', '.jpg', '.jpeg', '.webp']).name } }
    graph.n105_104.inputs.first_frame = ['preview_image', 0]
  }
  Object.assign(graph.n126.inputs, { images: ['n105_10', 0], frame_rate: config.fps, filename_prefix: `elysium/${jobId}/${profileName}/final` })
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
    profile, mode: plan.mode, workflowName: `${profileName}-${plan.mode}`, outputNode: 'n126', source: bundle.source,
    specification: { backend: config.backend, width, height, frames, fps: config.fps, seconds: frames / config.fps,
      ...(lowResolution ? { preview_variant: 'low-resolution' } : {}),
      requested_seconds: requestedSeconds, steps: config.steps, audio: 'joint-generation-and-decoding', interpolation: false } }
}
// 职责：把 preview 和 regular 档位配置应用到 H3 基础图。
