import { NodeStateModel } from '@agent-modules/task/models'
import { validateNodeOutput } from '../../node_runtime/output_response_parser.js'
import { nodeRules } from '../../node_runtime/node_state.js'
import { createNode } from '../../node_runtime/node_initializer.js'
import { digest } from '../script_revision/state.js'
import { groupOutput, characterGroups } from '../group_setting/state.js'

export { digest }

/** 仅投影旧资料的缺省字段，不改写磁盘或模型候选。 */
export function normalizeCharacterOutput(value) {
  return { characters: (value.characters || []).map(row => ({
    ...structuredClone(row), group_ids: structuredClone(row.group_ids || []),
    costumes: (row.costumes || []).map(costume => ({ group_id: '', group_costume_id: '', story_segment_ids: [], ...structuredClone(costume) })),
  })) }
}
export const characterOutput = project => normalizeCharacterOutput(project.character_extraction)
export const characterFingerprint = project => digest({ segments: project.story_segments.segments,
  scenes: project.scene_extraction?.scenes || [], groups: groupOutput(project).groups, group_status: project.group_setting?.node_state.status, rules: nodeRules(project.character_extraction.node_state) })

export function validateCharacterCandidate(value, { segments, groups: knownGroups = [] } = {}) {
  const output = validateNodeOutput('character_extraction', 'generate', value)
  const groups = new Map(), ids = new Set(), segmentIds = segments && new Set(segments.map(row => row.id))
  const unique = (rows, label) => {
    const seen = new Set()
    for (const row of rows) {
      const id = typeof row === 'string' ? row : row.id
      if (seen.has(id)) throw new TypeError(`${label} ID重复：${id}`)
      seen.add(id)
    }
  }
  const scope = costume => {
    unique(costume.story_segment_ids, '适用故事段')
    if (segmentIds) for (const id of costume.story_segment_ids) if (!segmentIds.has(id)) throw new TypeError(`服装引用不存在的故事段：${id}`)
  }
  for (const group of knownGroups) {
    if (groups.has(group.id)) throw new TypeError(`团队ID重复：${group.id}`)
    groups.set(group.id, group); unique(group.costumes, '团队服装'); group.costumes.forEach(scope)
    if (!group.appearance.trim()) throw new TypeError(`团队缺少基本形象：${group.id}`)
  }
  for (const character of output.characters) {
    if (ids.has(character.id)) throw new TypeError(`角色ID重复：${character.id}`)
    ids.add(character.id); unique(character.group_ids, '所属团队')
    for (const id of character.group_ids) if (!groups.has(id)) throw new TypeError(`人物引用不存在的团队：${id}`)
    for (const key of ['costumes', 'signature_props']) unique(character[key], key)
    for (const costume of character.costumes) {
      scope(costume)
      if (!!costume.group_id !== !!costume.group_costume_id) throw new TypeError('团队与团队服装引用需同时填写')
      if (!costume.group_id) continue
      const group = groups.get(costume.group_id), parent = group?.costumes.find(row => row.id === costume.group_costume_id)
      if (!group || !character.group_ids.includes(group.id) || !parent) throw new TypeError(`人物服装的团队或制服引用无效：${costume.id}`)
      if (parent.story_segment_ids.length && (!costume.story_segment_ids.length || costume.story_segment_ids.some(id => !parent.story_segment_ids.includes(id)))) throw new TypeError(`人物服装适用范围超出团队制服：${costume.id}`)
    }
  }
  return normalizeCharacterOutput(output)
}

export async function reconcileCharacterAssets(assets, previous, characters, previousGroups = [], groups = []) {
  const result = []
  for (const character of characters) {
    const asset = structuredClone(assets.find(row => row.character_id === character.id) || { character_id: character.id, reference_image: '', costume_images: [] })
    const old = previous.find(row => row.id === character.id)
    // 保留历史照片，仅使受人物或其关联团队变化影响的照片过期。
    for (const image of asset.costume_images) {
      const costume = character.costumes.find(row => row.id === image.costume_id), oldCostume = old?.costumes.find(row => row.id === image.costume_id)
      if (old && (digest(old) !== digest(character) || digest(characterGroups(previousGroups, old, oldCostume)) !== digest(characterGroups(groups, character, costume)))) {
        image.node_state = new NodeStateModel({ ...image.node_state, status: image.address ? 'expired' : 'empty', reason: image.address ? '人物或关联团队资料已变化，需重新生成' : '' }).toJSON()
      }
    }
    for (const costumeId of character.costumes.length ? character.costumes.map(row => row.id) : [null]) {
      if (!asset.costume_images.some(row => row.costume_id === costumeId)) asset.costume_images.push({ costume_id: costumeId, ...await createNode('costume_image') })
    }
    result.push(asset)
  }
  return [...result, ...assets.filter(row => !characters.some(character => character.id === row.character_id))]
}

export function expireCharacterDependents(project) {
  for (const type of ['shot_design', 'clip_arrangement', 'video_prompt']) {
    const node = project[type]
    if (node?.node_state.status !== 'empty') node.node_state = new NodeStateModel({ ...node.node_state, status: 'expired', reason: '人物或团队资料已变化，需重新生成' }).toJSON()
  }
}
