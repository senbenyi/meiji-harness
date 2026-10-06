import { parseJsonValue } from '../../gateway/model-gateway.js'
import { normalizeCharacters } from '../../../shared/story-content.js'
import { buildStoryPrompts } from '../../prompts/story-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForCharacters = (project, review = '', options = {}) => buildStoryPrompts(project, 'characters', review, options)
export function extractCharacters(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}

export const parseCharacters = (text, project) => normalizeCharacters(parseJsonValue(text), project)
