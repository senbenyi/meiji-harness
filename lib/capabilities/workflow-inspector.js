import { deriveWorkflowCapabilities } from './workflow-bindings.js'

const titleOf = (node) => String(node?._meta?.title || node?.title || node?.class_type || '').toLowerCase()
const target = (nodeId, input, extra = {}) => ({ nodeId: String(nodeId), input, ...extra })

export function inspectWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('workflow must be a node object')
  const bindings = { positivePrompt: [], negativePrompt: [], width: [], height: [], frames: [], seed: [], referenceImages: [], outputs: [] }
  const unlabeledText = []

  for (const [nodeId, node] of Object.entries(workflow)) {
    const inputs = node?.inputs || {}
    const type = String(node?.class_type || '').toLowerCase()
    const title = titleOf(node)
    for (const [input, value] of Object.entries(inputs)) {
      const key = input.toLowerCase()
      if ((key === 'text' || key === 'prompt') && typeof value === 'string' && /(text|prompt|clip)/.test(type)) {
        if (/(negative|avoid|负面|反向)/.test(title)) bindings.negativePrompt.push(target(nodeId, input))
        else if (/(positive|prompt|正向)/.test(title)) bindings.positivePrompt.push(target(nodeId, input))
        else unlabeledText.push(target(nodeId, input))
      }
      if (key === 'width' && Number.isFinite(Number(value))) bindings.width.push(target(nodeId, input))
      if (key === 'height' && Number.isFinite(Number(value))) bindings.height.push(target(nodeId, input))
      if (['frames', 'num_frames', 'length'].includes(key) && Number.isFinite(Number(value))) bindings.frames.push(target(nodeId, input))
      if (['seed', 'noise_seed'].includes(key) && Number.isFinite(Number(value))) bindings.seed.push(target(nodeId, input))
      if (key === 'image' && typeof value === 'string' && /(loadimage|image loader|加载图)/.test(type + ' ' + title)) {
        bindings.referenceImages.push(target(nodeId, input, { slot: bindings.referenceImages.length }))
      }
    }
    if (/(saveimage|previewimage)/.test(type)) bindings.outputs.push({ nodeId: String(nodeId), mediaType: 'image' })
    else if (/(video|vhs_.*combine|saveanimated)/.test(type) && /(save|combine|output)/.test(type + ' ' + title)) bindings.outputs.push({ nodeId: String(nodeId), mediaType: 'video' })
    else if (/(saveaudio|audio.*save)/.test(type)) bindings.outputs.push({ nodeId: String(nodeId), mediaType: 'audio' })
  }

  const ambiguities = []
  if (!bindings.positivePrompt.length && unlabeledText.length === 1) bindings.positivePrompt.push(unlabeledText[0])
  else if (unlabeledText.length) ambiguities.push({ semantic: 'positivePrompt', candidates: unlabeledText })
  for (const key of Object.keys(bindings)) if (!bindings[key].length) delete bindings[key]
  const unrecognized = []
  if (!bindings.positivePrompt) unrecognized.push('positivePrompt')
  if (!bindings.outputs) unrecognized.push('outputs')
  return {
    bindings,
    bindingStatus: ambiguities.length || unrecognized.length ? 'suggested' : 'confirmed',
    ambiguities,
    unrecognized,
    capabilities: deriveWorkflowCapabilities(bindings),
  }
}
