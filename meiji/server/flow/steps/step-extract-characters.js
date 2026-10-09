import { filmParticipants } from '../../../shared/film-characters.js'
import { parseJsonValue } from '../../gateway/model-gateway.js'
import { normalizeCharacters } from '../../../shared/story-content.js'
import { characterExtractionTarget } from '../../../shared/character-extraction.js'
import { buildStoryPrompts } from '../../prompts/story-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForCharacters = (project, review = '', options = {}) => buildStoryPrompts(project, 'characters', review, options)
export function extractCharacters(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}

export function parseCharacters(text, project) {
  const raw = parseJsonValue(text)
  for (const item of raw?.items || []) if (item && typeof item === 'object') characterExtractionTarget(project || {}, item)
  return { ...normalizeCharacters(raw, { project, allowEmpty: true, requireVoice: true, participants: project?.filmCharacterExtraction ? filmParticipants(project) : null }),
    extractionLibraryIds: (project?.library?.characters || []).map(entry => entry.id) }
}
