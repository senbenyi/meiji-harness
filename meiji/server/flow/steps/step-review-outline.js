import { promptsForOutline } from './step-generate-outline.js'
import { normalizeOutline } from '../../../shared/story-outline.js'
import { reviewStep } from './shared/text-review.js'

export function checkOutline(text, project, options = {}) {
  normalizeOutline(JSON.parse(text)); return []
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewOutline(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision),
    check: input.check || (text => checkOutline(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedOutlineInput(project, operation, node) {
  const content = node.content
  return { text: JSON.stringify(content), prompts: promptsForOutline(project) }
}
