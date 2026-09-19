// 职责：按 WorkCard 配置为 Agent 工具附加输出结构，并将内部任务结果渲染为稳定字段。
import { workcardConfig } from '../config.js'
import { jobSummary } from '../worker/index.js'

export const createCallToolsWorkcard = definition => {
  const schema = workcardConfig.schemas[workcardConfig.tools[definition.name]]
  return schema ? { ...definition, output: { schema, render: renderWorkcard } } : definition
}

export const renderWorkcard = (args, value) => {
  if (args.detail === true) return [{ type: 'text', text: JSON.stringify(value) }]
  const summary = jobSummary(value, { mode: args.mode, inferMediaKind: false })
  if (!workcardConfig.mediaMetadataStatuses.includes(summary.comfyui_metadata_status)) delete summary.comfyui_view_url
  const output = Object.fromEntries(workcardConfig.summaryFields.filter(key => summary[key] !== undefined).map(key => [key, summary[key]]))
  return [{ type: 'text', text: JSON.stringify(output) }]
}
