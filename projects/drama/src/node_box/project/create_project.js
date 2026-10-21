import { randomUUID } from 'node:crypto'
import { NodeStateModel } from '@agent-modules/task/models'
import { createNode } from '../../node_runtime/node_initializer.js'

export const projectFields = {
  name: { type: 'string', minLength: 1, maxLength: 100, description: '用户指定的项目名称' },
  creation_mode: { type: 'string', enum: ['剧本', '自由创作'], default: '剧本' },
  aspect_ratio: { type: 'string', enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], default: '9:16' },
  creative_requirements: { type: 'string', description: '用户提供的创作要求，未提供留空' },
  reference_episode_duration_seconds: { type: 'integer', minimum: 1, maximum: 86400, default: 180 },
  original_script: { type: 'string', description: '用户提供的原始剧本，未提供留空' },
}

export function projectInfo(input) {
  const info = { name: '', creation_mode: '剧本', aspect_ratio: '9:16', creative_requirements: '', reference_episode_duration_seconds: 180, original_script: '', ...input }
  for (const [key, value] of Object.entries(info)) {
    const spec = Object.hasOwn(projectFields, key) ? projectFields[key] : null
    const valid = spec && (spec.type === 'integer'
      ? Number.isSafeInteger(value) && value >= spec.minimum && value <= spec.maximum
      : typeof value === 'string' && (!spec.enum || spec.enum.includes(value)))
    if (!valid) throw new TypeError(`项目字段 ${key} 无效`)
  }
  info.name = info.name.trim()
  if (!info.name || info.name.length > 100) throw new TypeError('项目名称需为1—100字')
  return info
}

/** 空项目沿用运行时节点定义和公共规则/状态 Model，不读取开发文档模板。 */
export async function createProject(input, id = `p_${randomUUID()}`) {
  const project = { basic_info: { id, ...projectInfo(input) } }
  for (const type of ['script_revision', 'story_segments', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt'])
    project[type] = await createNode(type)
  project.clip_arrangement = { clips: [], node_state: new NodeStateModel().toJSON() }
  project.videos = []
  project.episodes = []
  return project
}
