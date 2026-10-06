import { promptsForProjectSummary } from './step-generate-project-summary.js'
import { projectSummaryFailures } from '../../../shared/script-content.js'
import { reviewStep } from './shared/text-review.js'

export function checkProjectSummary(text, project, options = {}) {
  return projectSummaryFailures(JSON.parse(text))
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewProjectSummary(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision),
    check: input.check || (text => checkProjectSummary(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedProjectSummaryInput(project, operation, node) {
  return { text: JSON.stringify({ summary: node.content }), prompts: promptsForProjectSummary(project) }
}
