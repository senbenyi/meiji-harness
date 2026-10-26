import { createHash } from 'node:crypto'

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const scriptFingerprint = project => digest({
  original: project.basic_info.original_script_file_path,
  rules: Object.fromEntries(Object.entries(project.basic_info.script_revision_node.rules).map(([action, rule]) => [action, {
    base: rule.base, supplement: project.basic_info.script_revision_node.supports_supplement ? rule.supplement : '',
  }])),
  supports_supplement: project.basic_info.script_revision_node.supports_supplement,
})
