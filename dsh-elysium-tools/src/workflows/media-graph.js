import { readFile } from 'node:fs/promises'
import { ModelTaskError } from '../jobs/contracts.js'
import { executionWorkflow } from './video-workflow.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

export async function buildMediaGraph(plan, media, jobId) {
  const { capability, params } = plan
  const name = capability === 'video-concat' ? 'workflow_concat_video' : `workflow_generate_image${params.image_path ? '_reference' : ''}`
  const source = JSON.parse(await readFile(new URL(`./templates/${name}.json`, import.meta.url), 'utf8'))
  let graph = structuredClone(source.graph), expected
  if (capability === 'image-generate') {
    graph['2'].inputs.text = params.prompt
    graph['5'].inputs.seed = params.seed
    if (params.image_path) graph['8'].inputs.image = media[params.image_path].name
    expected = { kind: 'image', width: graph['4'].inputs.width, height: graph['4'].inputs.height }
  } else {
    const inputs = params.video_paths.map(path => media[path]), first = inputs[0].info
    for (const { info } of inputs) {
      if (['width', 'height', 'frame_rate', 'has_audio', 'sample_rate', 'channels', 'video_codec', 'audio_codec'].some(k => info[k] !== first[k])) throw invalid('合片要求编码、画幅、帧率和音轨规格一致')
    }
    expected = { kind: 'video', ...first, duration_seconds: inputs.reduce((sum, v) => sum + v.info.duration_seconds, 0) }
    graph = {}
    const add = (id, prototype, inputs) => { graph[id] = structuredClone(source.graph[prototype]); Object.assign(graph[id].inputs, inputs); return [id, 0] }
    let frames, audio
    inputs.forEach((value, index) => {
      const video = add(`load_${index}`, '1', { file: value.name })
      const images = add(`components_${index}`, '2', { video })
      frames = index ? add(`frames_${index}`, '5', { image1: frames, image2: images }) : images
      if (first.has_audio) audio = index ? add(`audio_${index}`, '6', { audio1: audio, audio2: [`components_${index}`, 1] }) : [`components_${index}`, 1]
    })
    add('7', '7', { images: frames, frame_rate: first.frame_rate })
    if (audio) graph['7'].inputs.audio = audio
    else delete graph['7'].inputs.audio
  }
  graph['7'].inputs.filename_prefix = `elysium/${jobId}/final`
  return { graph, workflow: executionWorkflow(graph, source.workflow), workflowName: name, expected, plan }
}
