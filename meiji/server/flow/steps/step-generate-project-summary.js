import { buildTextPrompts } from '../../prompts/text-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForProjectSummary = (project, modify = false, opinion = '') => buildTextPrompts({ skill: 'project-summary', project, modify, opinion })
export function generateProjectSummary(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}
