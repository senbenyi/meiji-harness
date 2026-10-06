import { buildSecondsPrompts } from '../../prompts/shot-text-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForSeconds = (options) => buildSecondsPrompts(options)
export function generateSeconds(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}
