import { NodeStateModel } from '@agent-modules/task/models'
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
    const old = previous.find(row => row.id === scene.id), image = asset.image_generation
    if ((!old && image.address) || old && digest(old) !== digest(scene)) image.node_state = new NodeStateModel({ ...image.node_state,
      status: image.address ? 'expired' : 'empty', reason: image.address ? '场景资料已变化，需重新生成' : '' }).toJSON()
    result.push(asset)
  }
  return [...result, ...assets.filter(row => !scenes.some(scene => scene.id === row.scene_id))]
}

export function expireSceneDependents(project) {
  const expire = node => {
    if (node?.node_state && node.node_state.status !== 'empty') node.node_state = new NodeStateModel({ ...node.node_state, status: 'expired', reason: '场景资料或规则已变化，需重新确认或生成' }).toJSON()
  }
  // 团队/人物需要重审场景相容性；照片仍保留，造型真正改变后由对应盒子使照片过期。
  for (const type of ['group_setting', 'character_extraction', 'shot_design', 'clip_arrangement', 'video_prompt']) expire(project[type])
  const visit = value => {
    if (!value || typeof value !== 'object') return
    expire(value)
    for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules'].includes(key)) visit(child)
  }
  visit(project.videos); visit(project.episodes)
}
