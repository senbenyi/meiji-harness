import { promptsForShotTable, readShotSections } from './step-generate-shot-table.js'
import { referencedEntities } from '../../../shared/entity-references.js'
import { shotTableTiming } from '../../../shared/shot-table-timing.js'
import { reviewStep } from './shared/text-review.js'

export function checkShotTable(text, project, options = {}) {
  const items = readShotSections(text)
  const rows = items.map(item => ({ content: item.content, durationSeconds: item.duration }))
  referencedEntities(rows.map(row => row.content).join('\n'), project)
  return shotTableTiming(rows.map(row => row.durationSeconds), project.durationSeconds, project.plot.outline.content).failures
}
// 复审复用此步骤，只更新审核结论，不生成或修订正文。
export function reviewShotTable(input) {
  return reviewStep({ ...input, message: input.prompts.review(input.text, input.revision),
    check: input.check || (text => checkShotTable(text, input.options.project, input.options)) })
}

// 独立审核以已保存内容为待审输入，不读取生成草稿或清理下游。
export function savedShotTableInput(project, operation, node) {
  const shots = node.items.map(shot => {
    const lines = shot.content.split('\n'), title = lines[0].replace(/^标题[:：]\s*/, '')
    return { shotId: shot.id, durationSeconds: shot.duration, title, content: lines.slice(1).join('\n') || shot.content }
  })
  return { text: JSON.stringify({ shots }), prompts: promptsForShotTable({ project }) }
}
