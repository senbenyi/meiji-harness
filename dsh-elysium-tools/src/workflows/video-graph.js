import { readFile } from 'node:fs/promises'

import { executionWorkflow } from './video-workflow.js'

const workflowNames = ['workflow_generate_video', 'workflow_director_video']
export async function loadVideoTemplates() {
  return Object.fromEntries(await Promise.all(workflowNames.map(async name => [name,
    JSON.parse(await readFile(new URL(`./templates/${name}.json`, import.meta.url), 'utf8')),
  ])))
}
export const VIDEO_SETTINGS = (await loadVideoTemplates()).workflow_generate_video.settings

export function selectVideoWorkflow(shots) {
  return shots.length === 1 && shots[0].mode !== 'reuse' ? 'workflow_generate_video' : 'workflow_director_video'
}

function components(bundle) {
  return Object.fromEntries(Object.entries(bundle.workflow.extra.harness.components).map(([name, mapping]) => {
    const reverse = Object.fromEntries(Object.entries(mapping).map(([key, value]) => [value, key]))
    const graph = Object.fromEntries(Object.entries(mapping).map(([key, value]) => [key, structuredClone(bundle.graph[value])]))
    for (const node of Object.values(graph)) for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && reverse[value[0]]) node.inputs[key] = [reverse[value[0]], value[1]]
    }
    return [name, graph]
  }))
}

export function videoShots(plan, media) {
  if (plan.shots) return structuredClone(plan.shots)
  if (plan.video_paths) return plan.video_paths.map((path, index) => ({
    id: `shot-${index + 1}`, mode: 'reuse', video_path: path, duration: media[path].duration,
  }))
  const count = plan.prompts.length, seconds = Math.floor(plan.duration / count), remainder = plan.duration % count
  return plan.prompts.map((prompt, index) => ({
    id: `shot-${index + 1}`, mode: index ? 'continue' : 'independent', prompt,
    duration: seconds + (index < remainder ? 1 : 0),
    seed: ((plan.seed ?? 666) + index) % 2 ** 32,
    ...(!index && plan.image_path ? { image_path: plan.image_path } : {}),
  }))
}

// Select by presentation time, never reinterpret 24-fps frames as 30-fps frames.
export function frameIndices(seconds, outputFps, { fps, timestamps }, start = 0) {
  let cursor = 0
  return Array.from({ length: Math.round(seconds * outputFps) }, (_, index) => {
    const time = start + index / outputFps
    if (!timestamps) return Math.floor(time * fps + 1e-7)
    while (cursor + 1 < timestamps.length && timestamps[cursor + 1] <= time + 1e-7) cursor++
    return cursor
  })
}

export function buildVideoGraph(plan, media, workflows, jobId) {
  const graph = {}, shots = videoShots(plan, media), workflowName = selectVideoWorkflow(shots)
  const bundle = workflows[workflowName], settings = bundle.settings, templates = components(bundle)
  if (settings.fps !== 24) throw new Error('H3 模型时间基准必须为 24 fps；交付帧率请修改 outputFps')
  const add = (id, class_type, inputs) => {
    const prototype = bundle.graph[bundle.workflow.extra.harness.operations[class_type]]
    if (!prototype) throw new Error(`Missing workflow operation: ${class_type}`)
    graph[id] = structuredClone(prototype)
    Object.assign(graph[id].inputs, inputs)
    return [id, 0]
  }
  const clone = (template, prefix) => {
    for (const [id, node] of Object.entries(structuredClone(template))) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value) && typeof value[0] === 'string' && template[value[0]]) node.inputs[key] = [prefix + value[0], value[1]]
      }
      graph[prefix + id] = node
    }
  }
  const join = (links, prefix, type) => {
    let level = 0
    while (links.length > 1) {
      const next = []
      for (let i = 0; i < links.length; i += 2) next.push(i + 1 === links.length ? links[i] :
        add(`${prefix}${level}_${i}`, type, type === 'ImageBatch'
          ? { image1: links[i], image2: links[i + 1] }
          : { audio1: links[i], audio2: links[i + 1] }))
      links = next
      level++
    }
    return links[0]
  }
  let firstFrame
  if (plan.image_prompt) {
    clone(templates['first-frame'], 'first_')
    graph.first_2.inputs.text = plan.image_prompt
    graph.first_5.inputs.seed = plan.seed ?? 666
    delete graph.first_7
    firstFrame = ['first_6', 0]
  }
  const allImages = [], allAudio = []
  let previous
  for (const [index, shot] of shots.entries()) {
    const p = `s${index}_`, start = shot.in_point ?? 0
    let images, audio, timing
    if (shot.mode === 'reuse') {
      const source = media[shot.video_path]
      if (start + shot.duration > source.duration + 0.05) throw new Error(`镜头 ${shot.id} 素材时长不足`)
      const video = add(p + 'load', 'LoadVideo', { file: source.name })
      images = add(p + 'components', 'GetVideoComponents', { video })
      audio = source.hasAudio ? [p + 'components', 1] : null
      timing = source
    } else {
      const mode = shot.mode === 'reference' ? 'reference' : shot.image_path ? 'image' : 'text'
      clone(templates[mode], p)
      const director = graph[p + 'director'].inputs
      const items = ['image', 'video', 'audio'].filter(kind => shot[kind + '_path']).map((kind, order) => ({
        id: `reference-${kind}`, type: kind, value: media[shot[kind + '_path']].name, slot: 0, order, enabled: true,
        ...(kind === 'video' ? { media_mode: 'video_audio' } : {}),
      }))
      const timeline = JSON.parse(director.timeline_data)
      const builder = { version: 2, mode: director.mode, duration: shot.duration, prompt_mode: 'simple', simple_prompt: shot.prompt }
      Object.assign(director, { prompt: shot.prompt, width: settings.width, height: settings.height,
        duration: shot.duration, frame_rate: settings.fps,
        builder_state: JSON.stringify(builder),
        timeline_data: JSON.stringify({ ...timeline, items, prompt_blocks: [], builder_state: builder }) })
      graph[p + 'scheduler'].inputs.steps = settings.steps
      graph[p + 'noise'].inputs.seed_value = shot.seed ?? plan.seed ?? 666
      delete graph[p + 'save_video']
      const frame = shot.mode === 'continue' ? previous : index === 0 ? firstFrame : null
      if (frame) {
        // Director has no IMAGE socket. Its native conditioning node does.
        const prompt = `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n${shot.prompt}`
        add(p + 'conditioning', 'MiniMaxH3ImageToVideo', { clip: [p + 'lora', 1],
          vae: [p + 'load_video_vae', 0], prompt, width: settings.width, height: settings.height,
          length: [p + 'director', 1], first_frame: frame })
      }
      images = [p + 'decode_video', 0]
      audio = [p + 'decode_audio', 0]
      timing = { fps: settings.fps }
    }
    images = add(p + 'resize', 'ImageScale', { image: images })
    const indices = frameIndices(shot.duration, settings.outputFps, timing, start)
    const rendered = add(p + 'select_frames', 'ElysiumSelectFrames', { images, indices: JSON.stringify(indices) })
    previous = [p + 'select_frames', 1]
    allImages.push(rendered)
    const silence = add(p + 'silence', 'EmptyAudio', { duration: shot.duration + (audio ? start : 0) })
    if (audio) {
      audio = add(p + 'audio_pad', 'AudioConcat', { audio1: audio, audio2: silence })
      audio = add(p + 'audio_trim', 'TrimAudioDuration', { audio, start_index: start, duration: shot.duration })
    } else audio = silence
    allAudio.push(audio)
    graph[p + 'save'] = structuredClone(templates.text.save_video)
    Object.assign(graph[p + 'save'].inputs, { images: rendered, audio, frame_rate: settings.outputFps,
      filename_prefix: `elysium/${jobId}/shots/${shot.id}` })
  }
  const output = structuredClone(templates.text.save_video)
  Object.assign(output.inputs, { images: join(allImages, 'concat_video_', 'ImageBatch'),
    audio: join(allAudio, 'concat_audio_', 'AudioConcat'), frame_rate: settings.outputFps,
    filename_prefix: `elysium/${jobId}/final` })
  graph.final = output
  return { graph, shots, workflowName, settings, workflow: executionWorkflow(graph, bundle.workflow) }
}
