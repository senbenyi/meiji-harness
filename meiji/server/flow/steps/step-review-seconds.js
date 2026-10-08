import { promptsForSeconds } from './step-generate-seconds.js'
import { parseSecondsPartial } from '../../../shared/seconds-content.js'
import { reviewStep } from './shared/text-review.js'

export function checkSeconds(text, project, options = {}) {
  return Object.values(parseSecondsPartial(text, [project.shots.items.find(item => item.id === options.shotId)], project).failures)
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewSeconds(input) {
  let text = input.text
  try { text = JSON.stringify({ shots: parseSecondsPartial(text, [input.options.project.shots.items.find(shot => shot.id === input.options.shotId)], input.options.project).sections }) }
  catch { /* 解析错误由程序审核保留，不用空内容替代失败原稿。 */ }
  return reviewStep({ ...input, text, message: input.prompts.review(text, input.revision),
    check: input.check || (text => checkSeconds(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedSecondsInput(project, operation, node) {
  return { text: JSON.stringify({ shots: [node.content] }), prompts: promptsForSeconds({ project, shotId: operation.track }) }
}
