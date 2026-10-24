import { scriptSourceInfo } from './script_files.js'
import { randomUUID } from 'node:crypto'
import { NodeStateModel } from '@agent-modules/task/models'
import { createNode } from '../../node_runtime/node_initializer.js'

export const projectFields = {
  name: { type: 'string', minLength: 1, maxLength: 100, description: '用户指定的项目名称' },
  creation_mode: { type: 'string', enum: ['剧本', '自由创作'], default: '剧本' },
  aspect_ratio: { type: 'string', enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], default: '9:16' },
  reference_episode_duration_seconds: { type: 'integer', minimum: 1, maximum: 86400, default: 180 },
  original_script_filename: { type: 'string', description: '本地或素材库剧本的原始文件名，未提供使用剧本.txt' },
  original_script: { type: 'string', description: '创建入参中的剧本正文；保存时写入沙盒文件，项目JSON的original_script_file_path保存相对路径；未提供留空' },
}

export function projectInfo(input) {
  const info = { name: '', creation_mode: '剧本', aspect_ratio: '9:16', reference_episode_duration_seconds: 180, original_script: '', original_script_filename: '', ...input }
  for (const [key, value] of Object.entries(info)) {
    const spec = Object.hasOwn(projectFields, key) ? projectFields[key] : null
    const valid = spec && (spec.type === 'integer'
      ? Number.isSafeInteger(value) && value >= spec.minimum && value <= spec.maximum
      : typeof value === 'string' && (!spec.enum || spec.enum.includes(value)))
    if (!valid) throw new TypeError(`项目字段 ${key} 无效`)
  }
  info.name = info.name.trim()
  if (!info.name || info.name.length > 100) throw new TypeError('项目名称需为1—100字')
  scriptSourceInfo(info.original_script, info.original_script_filename)
  return info
}

/** 空项目沿用运行时节点定义和公共规则/状态 Model，不读取开发文档模板。 */
export async function createProject(input, id = `p_${randomUUID()}`) {
  const info = projectInfo(input)
  const { original_script, original_script_filename, ...metadata } = info
  const script = await createNode('script_revision')
  const project = { basic_info: { id, ...metadata, ...scriptSourceInfo(original_script, original_script_filename), actual_script: original_script, summary: '', estimated_duration_seconds: 0,
    create_project_node: new NodeStateModel({ status: 'generated' }).toJSON(), script_revision_node: script.node_state } }
  for (const type of ['story_segments', 'group_setting', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt'])
    project[type] = await createNode(type)
  project.clip_arrangement = { clips: [], node_state: new NodeStateModel().toJSON() }
  project.videos = []
  project.episodes = []
  return project
}
