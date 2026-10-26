import { validateNodeOutput } from '../../node_runtime/output_response_parser.js'
import { nodeRules } from '../../node_runtime/node_state.js'
import { createNode } from '../../node_runtime/node_initializer.js'
import { digest } from '../script_revision/state.js'

export { digest }
export const sceneOutput = project => ({ scenes: structuredClone(project.scene_extraction.scenes) })
export const sceneFingerprint = project => digest({ segments: project.story_segments.segments, rules: nodeRules(project.scene_extraction.node_state) })

export function validateSceneCandidate(value) {
  const output = validateNodeOutput('scene_extraction', 'generate', value), ids = new Set()
  for (const scene of output.scenes) {
    if (ids.has(scene.id)) throw new TypeError(`场景ID重复：${scene.id}`)
    ids.add(scene.id)
  }
  return output
}

/** 只维护资产对应关系，不请求生图；被移除的场景资产继续保留。 */
export async function reconcileSceneAssets(assets, previous, scenes, aspectRatio) {
  const result = []
  for (const scene of scenes) {
    const asset = structuredClone(assets.find(row => row.scene_id === scene.id) || { scene_id: scene.id })
    asset.image_generation ||= { ...await createNode('scene_image'), aspect_ratio: aspectRatio }
    result.push(asset)
  }
  return [...result, ...assets.filter(row => !scenes.some(scene => scene.id === row.scene_id))]
}
