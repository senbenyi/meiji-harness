// 职责：由 main 分支模板构建 AutoDL RealVisXL、参考图和角色三视图 ComfyUI 图。
import { readFile } from '../../../../../../database/files.js'
import { ModelTaskError } from '../../../../../../utils/errors.js'
import { executionWorkflow } from '../workflow.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

// 视频首帧与同质量档 H3 视频同比例，长边 1152，按 8 对齐。
async function keyframeSize(quality = 'regular') {
  const video = JSON.parse(await readFile(new URL(`../minimax-h3/profiles/${quality}.json`, import.meta.url), 'utf8'))
  return { width: Math.round(1152 * video.width / video.height / 8) * 8, height: 1152 }
}

export async function buildImageGraph(plan, media, jobId) {
  const { capability, params } = plan
  const name = capability === 'image-compose' ? 'workflow_character_sheet'
    : params.character ? `workflow_character_${params.character.view === 'front' ? 'front' : 'view'}`
      : `workflow_generate_image${params.image_path ? '_reference' : ''}`
  const source = JSON.parse(await readFile(new URL(`./templates/${name}.json`, import.meta.url), 'utf8'))
  const graph = structuredClone(source.graph)
  let expected
  if (capability === 'image-generate') {
    const profile = JSON.parse(await readFile(new URL(`./profiles/${plan.quality || 'regular'}.json`, import.meta.url), 'utf8'))
    graph['2'].inputs.text = params.prompt
    graph['5'].inputs.seed = params.seed
    Object.assign(graph['4'].inputs, params.purpose === 'keyframe' ? await keyframeSize(plan.quality) : { width: profile.width, height: profile.height })
    graph['5'].inputs.steps = profile.steps
    if (params.image_path) graph['8'].inputs.image = media[params.image_path].name
    if (params.character) {
      graph['11'].inputs.image = media.pose.name
      graph['3'].inputs.text += ', collage, multiple people, bent knees, crossed legs, hands in pockets, fashion pose, tilted head'
    }
    expected = { kind: 'image', width: graph['4'].inputs.width, height: graph['4'].inputs.height }
  } else {
    expected = { kind: 'image', width: graph['4'].inputs.width, height: graph['4'].inputs.height }
    const column = expected.width / 3, targetHeight = expected.height - 96
    params.views.forEach(({ path, crop }, index) => {
      const input = media[path], base = (index + 1) * 10
      const width = Math.round(crop.width * targetHeight / crop.height)
      if (crop.x + crop.width > input.info.width || crop.y + crop.height > input.info.height || width > column - 32) {
        throw invalid('人物边界越界或过宽，请保留完整单人全身且不要截断身体')
      }
      graph[base].inputs.image = input.name
      Object.assign(graph[base + 1].inputs, crop)
      Object.assign(graph[base + 2].inputs, { width, height: targetHeight })
      Object.assign(graph[base + 3].inputs, { x: index * column + Math.round((column - width) / 2), y: 48 })
    })
  }
  graph['7'].inputs.filename_prefix = `elysium/${jobId}/final`
  return { graph, workflow: executionWorkflow(graph, source.workflow), workflowName: name, outputNode: '7', expected, plan,
    quality: plan.quality, specification: { width: expected.width, height: expected.height, ...(capability === 'image-generate' ? { steps: graph['5'].inputs.steps } : {}) } }
}
