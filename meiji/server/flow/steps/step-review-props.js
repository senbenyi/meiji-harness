import { cardContent } from './shared/card-content.js'
import { promptsForProps } from './step-extract-props.js'
import { normalizeProps } from '../../../shared/story-content.js'
import { reviewStep } from './shared/text-review.js'

export function checkProps(text, project, options = {}) {
  normalizeProps(JSON.parse(text), project); return []
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewProps(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision),
    check: input.check || (text => checkProps(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedPropsInput(project, operation, node) {
  return { text: JSON.stringify(cardContent(node)), prompts: promptsForProps(project) }
}
