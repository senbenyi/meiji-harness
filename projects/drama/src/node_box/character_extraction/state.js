import { NodeStateModel } from '@agent-modules/task/models'
import { validateNodeOutput } from '../../node_runtime/output_response_parser.js'
import { nodeRules } from '../../node_runtime/node_state.js'
import { createNode } from '../../node_runtime/node_initializer.js'
import { digest } from '../script_revision/state.js'

export { digest }
export const characterOutput = project => ({ characters: structuredClone(project.character_extraction.characters) })
export const characterFingerprint = project => digest({ segments: project.story_segments.segments, rules: nodeRules(project.character_extraction.node_state) })

export function validateCharacterCandidate(value) {
  const output = validateNodeOutput('character_extraction', 'generate', value)
  const ids = new Set()
  for (const character of output.characters) {
    if (ids.has(character.id)) throw new TypeError(`角色ID重复：${character.id}`)
    ids.add(character.id)
    for (const key of ['costumes', 'signature_props']) {
      const children = new Set()
      for (const row of character[key]) {
        if (children.has(row.id)) throw new TypeError(`${key} ID重复：${row.id}`)
        children.add(row.id)
      }
    }
  }
  return output
}

export async function reconcileCharacterAssets(assets, previous, characters) {
  const result = []
  for (const character of characters) {
    const asset = structuredClone(assets.find(row => row.character_id === character.id) || { character_id: character.id, reference_image: '', costume_images: [] })
    const old = previous.find(row => row.id === character.id)
    // 保留历史照片，不删除用户资产；资料变化后标记照片过期。
    if (old && digest(old) !== digest(character)) for (const image of asset.costume_images) {
      image.node_state = new NodeStateModel({ ...image.node_state, status: image.address ? 'expired' : 'empty', reason: image.address ? '角色资料已变化，需重新生成' : '' }).toJSON()
    }
    for (const costumeId of character.costumes.length ? character.costumes.map(row => row.id) : [null]) {
      if (!asset.costume_images.some(row => row.costume_id === costumeId)) asset.costume_images.push({ costume_id: costumeId, ...await createNode('costume_image') })
    }
    result.push(asset)
  }
  // 已移除人物的素材仍保留，不参与新的批量生成。
  return [...result, ...assets.filter(row => !characters.some(character => character.id === row.character_id))]
}

export function expireCharacterDependents(project) {
  for (const type of ['shot_design', 'clip_arrangement', 'video_prompt']) {
    const node = project[type]
    if (node?.node_state.status !== 'empty') node.node_state = new NodeStateModel({ ...node.node_state, status: 'expired', reason: '角色资料已变化，需重新生成' }).toJSON()
  }
}
