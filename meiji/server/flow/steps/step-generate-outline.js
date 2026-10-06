import { parseJsonValue } from '../../gateway/model-gateway.js'
import { normalizeOutline } from '../../../shared/story-outline.js'
import { buildStoryPrompts } from '../../prompts/story-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForOutline = (project) => buildStoryPrompts(project, 'outline')
export function generateOutline(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}

export const parseOutline = text => normalizeOutline(parseJsonValue(text))
