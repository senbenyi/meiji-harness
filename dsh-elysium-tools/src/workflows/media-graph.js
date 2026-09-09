import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, relative, isAbsolute } from 'node:path'
import { requiredConfig } from '../config.js'
import { ModelTaskError } from '../functions/common/task.js'
import { executionWorkflow } from './video-workflow.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)
export async function validateMediaPlan({ capability, params }) {
  if (!['image-generate', 'video-concat'].includes(capability)) throw invalid('未支持的媒体任务')
  if (capability === 'image-generate') {
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw invalid('prompt 不能为空')
    if (params.preset !== undefined && params.preset !== 'standard') throw invalid('图片仅支持 standard')
    if (!Number.isInteger(params.seed) || params.seed < 0 || params.seed > 2 ** 32 - 1) throw invalid('seed 必须为 uint32')
  } else if (!Array.isArray(params.video_paths) || params.video_paths.length < 2) throw invalid('至少需要两个视频')
  const paths = capability === 'image-generate' ? (params.image_path === undefined ? [] : [params.image_path]) : params.video_paths
  const root = await realpath(requiredConfig('ARTIFACTS_ROOT'))
  for (const path of paths) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw invalid('素材必须为绝对路径')
    const resolved = await realpath(path).catch(() => { throw invalid('素材不存在') })
    const rel = relative(root, resolved), extensions = capability === 'image-generate' ? ['.png', '.jpg', '.jpeg', '.webp'] : ['.mp4']
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !extensions.includes(extname(resolved).toLowerCase()) || !(await stat(resolved)).isFile()) throw invalid('素材必须为 artifacts 内支持格式的文件')
  }
}

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
