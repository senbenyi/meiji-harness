import { buildEpisodePrompts } from '../../prompts/episode-summary-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForSummary = (project, episodeId, duration) => buildEpisodePrompts(project, episodeId, duration)
export function generateSummary(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}
