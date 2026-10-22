import { RulesModel } from '@agent-modules/prompt-composer'

/** 项目只保存一份动作规则；公共编排与UI需要RulesModel时在边界投影。 */
export function nodeRules(state) {
  return new RulesModel({ supports_supplement: state.supports_supplement, rules: state.rules }).toJSON()
}

export function scriptOutput(project) {
  const { actual_script, summary, estimated_duration_seconds } = project.basic_info
  return { actual_script, summary, estimated_duration_seconds }
}

export function originalFilename(info) {
  return info.original_script_file_path?.split('/').at(-1) || ''
}

export function scriptSummary(project) {
  const { summary, estimated_duration_seconds } = project.basic_info
  return { summary, estimated_duration_seconds }
}

export function nodeState(project, type) {
  if (type === 'project') return project.basic_info.create_project_node
  if (type === 'script_revision') return project.basic_info.script_revision_node
  return project[type]?.node_state
}
