// 职责：按 WorkCard 配置为 Agent 工具附加输出结构，并将内部任务结果渲染为稳定字段。
import { readFileSync } from 'node:fs'
import { jobSummary } from '../../server/media/catalog.js'

const workcard = JSON.parse(readFileSync(new URL('../../../config/workcard.json', import.meta.url), 'utf8'))

export const createCallToolsWorkcard = definition => {
  const schema = workcard.schemas[workcard.tools[definition.name]]
  return schema ? { ...definition, output: { schema, render: renderWorkcard } } : definition
}

export const renderWorkcard = (args, value) => {
  if (args.detail === true) return [{ type: 'text', text: JSON.stringify(value) }]
  const summary = jobSummary(value, { mode: args.mode, inferMediaKind: false })
  if (!workcard.mediaMetadataStatuses.includes(summary.comfyui_metadata_status)) delete summary.comfyui_view_url
  const output = Object.fromEntries(workcard.summaryFields.filter(key => summary[key] !== undefined).map(key => [key, summary[key]]))
  return [{ type: 'text', text: JSON.stringify(output) }]
}
