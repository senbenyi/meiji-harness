import { promptsForSummary } from './step-generate-summary.js'
import { episodeSummaryFailures } from '../../../shared/episode-summary.js'
import { reviewStep } from './shared/text-review.js'

export function checkSummary(text, project, options = {}) {
  return episodeSummaryFailures(JSON.parse(text))
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewSummary(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision),
    check: input.check || (text => checkSummary(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedSummaryInput(project, operation, node) {
  const episode = project.episodes.find(item => item.id === operation.episodeId)
  return { text: JSON.stringify({ summary: node.content }), prompts: promptsForSummary(project, episode.id, episode.durationSeconds) }
}
