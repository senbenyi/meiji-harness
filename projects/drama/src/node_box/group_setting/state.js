import { validateNodeOutput } from '../../node_runtime/output_response_parser.js'
import { nodeRules } from '../../node_runtime/node_state.js'
import { digest } from '../script_revision/state.js'

export { digest }
export const groupOutput = project => ({ groups: structuredClone(project.group_setting?.groups ?? project.character_extraction?.groups ?? []) })
export const groupFingerprint = project => digest({ segments: project.story_segments.segments, scenes: project.scene_extraction?.scenes || [], rules: nodeRules(project.group_setting.node_state) })

/** 只提供实际所属团队的基本形象和本次选定制服。 */
export function characterGroups(groups, character, costume) {
  const ids = new Set([...(character.group_ids || []), ...(costume?.group_id ? [costume.group_id] : [])])
  return groups.filter(row => ids.has(row.id)).map(row => ({ ...structuredClone(row),
    costumes: row.id === costume?.group_id ? row.costumes.filter(c => c.id === costume.group_costume_id).map(c => structuredClone(c)) : [],
  }))
}

export function validateGroupCandidate(value, { segments } = {}) {
  const output = validateNodeOutput('group_setting', 'generate', value), ids = new Set()
  const segmentIds = segments && new Set(segments.map(row => row.id))
  for (const group of output.groups) {
    if (ids.has(group.id)) throw new TypeError(`团队ID重复：${group.id}`)
    ids.add(group.id)
    const costumes = new Set()
    for (const costume of group.costumes) {
      if (costumes.has(costume.id)) throw new TypeError(`团队服装ID重复：${costume.id}`)
      costumes.add(costume.id)
      if (new Set(costume.story_segment_ids).size !== costume.story_segment_ids.length) throw new TypeError('适用故事段ID重复')
      if (segmentIds) for (const id of costume.story_segment_ids) if (!segmentIds.has(id)) throw new TypeError(`服装引用不存在的故事段：${id}`)
    }
  }
  return output
}
