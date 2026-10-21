import { RulesModel } from '@agent-modules/prompt-composer'
import { projectInfo } from './create_project.js'

const editable = ['name', 'aspect_ratio', 'creative_requirements', 'reference_episode_duration_seconds']
const nodes = ['script_revision']
const invalid = message => { throw new TypeError(message) }
const conflict = () => { throw Object.assign(new Error('资料已被修改，请刷新后重新编辑'), { code: 'EDIT_CONFLICT' }) }
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('编辑参数需为对象')
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`不允许编辑字段：${key}`)
}
function text(value) { if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 * 1024) invalid('编辑内容需为不超过1MiB的文本') }

/** 只修改项目已有的人工字段；输出、ID、模式、资产和节点状态不可经此入口覆盖。 */
export function editProject(project, command) {
  object(command, ['kind', 'values', 'previous', 'value', 'previousValue', 'node_type', 'action', 'field'])
  const next = structuredClone(project)
  if (command.kind === 'basic_info') {
    object(command.values, editable); object(command.previous, editable)
    if (!Object.keys(command.values).length) invalid('没有需要保存的资料')
    for (const [key, value] of Object.entries(command.values)) {
      if (!Object.hasOwn(command.previous, key) || command.previous[key] !== project.basic_info[key]) conflict()
      next.basic_info[key] = value
    }
    const { id, ...info } = next.basic_info
    next.basic_info = { id, ...projectInfo(info) }
  } else if (command.kind === 'import_script') {
    text(command.value); text(command.previousValue)
    if (!command.value.trim()) invalid('剧本不能为空')
    if (project.basic_info.original_script !== command.previousValue) conflict()
    next.basic_info.original_script = command.value
  } else if (command.kind === 'node_opinion') {
    text(command.value); text(command.previousValue)
    if (project.script_revision.opinion !== command.previousValue) conflict()
    next.script_revision.opinion = command.value
  } else if (command.kind === 'rules') {
    if (!nodes.includes(command.node_type) || !next[command.node_type]?.rules) invalid('规则节点不存在')
    if (!['generate', 'review', 'revise'].includes(command.action) || command.field !== 'supplement') invalid('只允许保存本动作的补充规则')
    text(command.value); text(command.previousValue)
    const rules = new RulesModel(next[command.node_type].rules)
    if (rules.rules[command.action].supplement !== command.previousValue) conflict()
    rules.setSupplement(command.action, command.value)
    next[command.node_type].rules = rules.toJSON()
  } else invalid('未知项目编辑操作')
  return next
}
