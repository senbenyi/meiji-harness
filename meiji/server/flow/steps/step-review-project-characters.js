import { characterExtractionContent, characterExtractionProject } from '../../../shared/character-extraction.js'
import { parseCharacters } from './step-extract-characters.js'
import { projectCharacterPrompts } from '../../prompts/project-character-prompts.js'
import { reviewStep } from './shared/text-review.js'

export function savedProjectCharactersInput(project, operation, node) {
  if (node.basis?.scriptRevision !== project.scriptRevision) throw Object.assign(new Error('剧本已修改，请重新提取角色'), { status: 409 })
  const source = characterExtractionProject(project, node)
  return { text: JSON.stringify(characterExtractionContent(source, node)), prompts: projectCharacterPrompts(source), check: text => { parseCharacters(text, source); return [] } }
}
export function reviewProjectCharacters(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision) })
}
