import { nodeRules, nodeState, originalFilename } from '../../node_runtime/node_state.js'
import { scriptSourceInfo } from './script_files.js'
import { NodeStateModel } from '@agent-modules/task/models'
import { RulesModel } from '@agent-modules/prompt-composer'
import { projectInfo } from './create_project.js'

const editable = ['name', 'aspect_ratio', 'reference_episode_duration_seconds']
const nodes = ['script_revision', 'story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'shot_design']
const opinionNodes = ['script_revision', 'story_segments', 'group_setting', 'character_extraction', 'scene_extraction', 'shot_design', 'video_prompt']
const invalid = message => { throw new TypeError(message) }
const conflict = () => { throw Object.assign(new Error('资料已被修改，请刷新后重新编辑'), { code: 'EDIT_CONFLICT' }) }
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('编辑参数需为对象')
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`不允许编辑字段：${key}`)
}
function text(value) { if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 * 1024) invalid('编辑内容需为不超过1MiB的文本') }

/** 只修改项目已有的人工字段；输出、ID、模式、资产和节点状态不可经此入口覆盖。 */
export function editProject(project, command) {
  object(command, ['kind', 'values', 'previous', 'value', 'previousValue', 'node_type', 'action', 'field', 'originalName'])
  const next = structuredClone(project)
  if (command.kind === 'basic_info') {
    object(command.values, editable); object(command.previous, editable)
    if (!Object.keys(command.values).length) invalid('没有需要保存的资料')
    for (const [key, value] of Object.entries(command.values)) {
      if (!Object.hasOwn(command.previous, key) || command.previous[key] !== project.basic_info[key]) conflict()
      next.basic_info[key] = value
    }
    projectInfo(Object.fromEntries(['name', 'creation_mode', 'aspect_ratio', 'reference_episode_duration_seconds'].map(key => [key, next.basic_info[key]])))
  } else if (command.kind === 'import_script') {
    text(command.value); text(command.previousValue)
    if (!command.value.trim()) invalid('剧本不能为空')
    if (project.basic_info.original_script_file_path !== command.previousValue) conflict()
    Object.assign(next.basic_info, scriptSourceInfo(command.value, command.originalName || originalFilename(project.basic_info)))
    Object.assign(next.basic_info, { actual_script: command.value, summary: '', estimated_duration_seconds: 0 })
    next.basic_info.script_revision_node = new NodeStateModel({ ...next.basic_info.script_revision_node, status: 'empty', reason: '', opinion: '', dependency_hash: '' }).toJSON()
  } else if (command.kind === 'node_opinion') {
    text(command.value); text(command.previousValue)
    const type = command.node_type ?? 'script_revision'
    if (!opinionNodes.includes(type) || !nodeState(next, type)) invalid('意见节点不存在')
    if (nodeState(project, type).opinion !== command.previousValue) conflict()
    nodeState(next, type).opinion = command.value
  } else if (command.kind === 'rules') {
    if (!nodes.includes(command.node_type) || !nodeState(next, command.node_type)?.rules) invalid('规则节点不存在')
    if (!['generate', 'review', 'revise'].includes(command.action) || command.field !== 'supplement') invalid('只允许保存本动作的补充规则')
    text(command.value); text(command.previousValue)
    const rules = new RulesModel(nodeRules(nodeState(next, command.node_type)))
    if (rules.rules[command.action].supplement !== command.previousValue) conflict()
    rules.setSupplement(command.action, command.value)
    nodeState(next, command.node_type).rules = rules.toJSON().rules
  } else invalid('未知项目编辑操作')
  return next
}
