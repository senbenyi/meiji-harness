import { cardContent } from './shared/card-content.js'
import { promptsForScenes } from './step-extract-scenes.js'
import { normalizeScenes } from '../../../shared/story-content.js'
import { reviewStep } from './shared/text-review.js'

export function checkScenes(text, project, options = {}) {
  normalizeScenes(JSON.parse(text)); return []
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewScenes(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision),
    check: input.check || (text => checkScenes(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedScenesInput(project, operation, node) {
  return { text: JSON.stringify(cardContent(node)), prompts: promptsForScenes(project) }
}
