import { parseJsonValue } from '../../gateway/model-gateway.js'
import { normalizeScenes } from '../../../shared/story-content.js'
import { buildStoryPrompts } from '../../prompts/story-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForScenes = (project, review = '', options = {}) => buildStoryPrompts(project, 'scenes', review, options)
export function extractScenes(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}

export const parseScenes = (text, project) => normalizeScenes(parseJsonValue(text), project)
