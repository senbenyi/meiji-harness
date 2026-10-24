import { createHash } from 'node:crypto'
import { NodeStateModel } from '@agent-modules/task/models'

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const scriptFingerprint = project => digest({
  original: project.basic_info.original_script_file_path,
  rules: Object.fromEntries(Object.entries(project.basic_info.script_revision_node.rules).map(([action, rule]) => [action, {
    base: rule.base, supplement: project.basic_info.script_revision_node.supports_supplement ? rule.supplement : '',
  }])),
  supports_supplement: project.basic_info.script_revision_node.supports_supplement,
})
export function expireScriptDependents(project) {
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (value.node_state && value.node_state.status !== 'empty') value.node_state = new NodeStateModel({ ...value.node_state, status: 'expired', reason: '上游剧本已变化，需重新确认或生成' }).toJSON()
    for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules', 'output'].includes(key)) visit(child)
  }
  for (const key of ['story_segments', 'group_setting', 'character_extraction', 'scene_extraction', 'shot_design', 'clip_arrangement', 'video_prompt', 'videos', 'episodes']) visit(project[key])
}
