import { createHash } from 'node:crypto'
import { NodeStateModel } from '@agent-modules/task/models'

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const scriptFingerprint = project => digest({
  original: project.basic_info.original_script,
  requirements: project.basic_info.creative_requirements,
  duration: project.basic_info.reference_episode_duration_seconds,
  rules: project.script_revision.rules,
})
export function expireScriptDependents(project) {
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (value.node_state && value.node_state.status !== 'empty') value.node_state = new NodeStateModel({ ...value.node_state, status: 'expired', reason: '上游剧本已变化，需重新确认或生成' }).toJSON()
    for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules', 'output'].includes(key)) visit(child)
  }
  for (const key of ['story_segments', 'character_extraction', 'scene_extraction', 'shot_design', 'clip_arrangement', 'video_prompt', 'videos', 'episodes']) visit(project[key])
}
