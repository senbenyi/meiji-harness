import { cardContent } from './shared/card-content.js'
import { promptsForCharacters } from './step-extract-characters.js'
import { normalizeCharacters } from '../../../shared/story-content.js'
import { reviewStep } from './shared/text-review.js'

export function checkCharacters(text, project, options = {}) {
  normalizeCharacters(JSON.parse(text)); return []
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewCharacters(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision),
    check: input.check || (text => checkCharacters(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedCharactersInput(project, operation, node) {
  return { text: JSON.stringify(cardContent(node)), prompts: promptsForCharacters(project) }
}
