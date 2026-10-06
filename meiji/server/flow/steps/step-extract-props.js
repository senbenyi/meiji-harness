import { parseJsonValue } from '../../gateway/model-gateway.js'
import { normalizeProps } from '../../../shared/story-content.js'
import { buildStoryPrompts } from '../../prompts/story-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForProps = (project, review = '', options = {}) => buildStoryPrompts(project, 'props', review, options)
export function extractProps(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}

export const parseProps = (text, project) => normalizeProps(parseJsonValue(text), project)
