import { NodeStateModel } from '@agent-modules/task/models'
import { validateNodeOutput } from '../../node_runtime/output_response_parser.js'
import { scriptOutput, nodeRules } from '../../node_runtime/node_state.js'
import { digest } from '../script_revision/state.js'

export { digest }
export const storyOutput = project => ({ segments: structuredClone(project.story_segments.segments) })
export const storyFingerprint = project => digest({ basic_info: scriptOutput(project), rules: nodeRules(project.story_segments.node_state) })

export function validateStoryCandidate(value, { previousOutline } = {}) {
  const output = validateNodeOutput('story_segments', 'generate', value)
  if (!output.segments.length) throw new TypeError('故事大纲至少需要一个故事段')
  const existing = new Set((previousOutline?.segments || []).flatMap(segment => segment.key_anchors.map(anchor => anchor.id)))
  const ids = new Set(), anchors = new Set()
  for (const segment of output.segments) {
    if (ids.has(segment.id)) throw new TypeError(`故事段ID重复：${segment.id}`)
    ids.add(segment.id)
    for (const anchor of segment.key_anchors) {
      if (anchors.has(anchor.id)) throw new TypeError(`关键锚点ID重复：${anchor.id}`)
      if (!existing.has(anchor.id)) {
        const prefix = `${segment.id}_anchor_`, suffix = anchor.id.startsWith(prefix) ? anchor.id.slice(prefix.length) : ''
        if (!/^\d{3,}$/.test(suffix) || !/[1-9]/.test(suffix)) throw new TypeError(`新增关键锚点ID需使用所属故事段前缀及至少三位正整数序号，例如${prefix}001；实际：${anchor.id}`)
      }
      anchors.add(anchor.id)
    }
  }
  return output
}

export function expireStoryDependents(project) {
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (value.node_state && value.node_state.status !== 'empty') value.node_state = new NodeStateModel({ ...value.node_state, status: 'expired', reason: '上游故事大纲已变化，需重新确认或生成' }).toJSON()
    for (const [key, child] of Object.entries(value)) if (!['node_state', 'rules'].includes(key)) visit(child)
  }
  for (const key of ['character_extraction', 'scene_extraction', 'shot_design', 'clip_arrangement', 'video_prompt', 'videos', 'episodes']) visit(project[key])
}
