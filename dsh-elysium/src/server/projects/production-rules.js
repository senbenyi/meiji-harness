// 职责：按制作阶段加载创作规则，并注入当前项目时长。
import { readFile } from 'node:fs/promises'

const filesByStage = new Map([
  ['story', ['story.md', 'scenes.md']],
  ['segments', ['segments.md']],
  ['shots', ['shots.md']],
  ['inputs', ['h3-prompt.md']],
])

export async function loadProductionInstructions(stage, targetSeconds) {
  const files = filesByStage.get(stage)
  if (!files) throw new Error(`未知制作规则阶段：${stage}`)
  const rules = await Promise.all(files.map(file => readFile(new URL(`../../../resources/production-rules/${file}`, import.meta.url), 'utf8')))
  return rules.join('\n\n').replaceAll('{{target_seconds}}', String(targetSeconds))
}
