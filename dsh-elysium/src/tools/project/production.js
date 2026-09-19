// 职责：提供制作阶段的 AI 读取、原子回写和局部编辑，不暴露视频审核提交。
import { batchRequest } from '../../server/projects/production-batches.js'
export function createProductionTools(workflow, output) {
  const text = { type: 'string' }, data = { type: 'object', additionalProperties: true }
  const schema = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required })
  const saved = { ...output, render: (_args, value) => [{ type: 'text', text: JSON.stringify({ project_id: value.id, revision: value.production.revision, stage: value.production.stage, request: batchRequest(value.production.request),
    notice: value.production.request ? '本批已保存，本阶段尚未完成。立即 project_production_read 获取下一批并继续 project_production_complete；只继续当前阶段，不生成视频。' : '本阶段已全部保存，等待页面下一步；不生成视频。' }) }] }
  return [
    { name: 'project_edit_production', description: '根据用户要求修改当前项目创作要求或 Scene 剧情；先 project_read。description 的 data 为 requirements/style/aspect_ratio/target_seconds；story 为 text/scenes 全量。不能生成或提交视频。',
      parameters: schema({ project_id: text, revision: { type: 'integer' }, action: { type: 'string', enum: ['description', 'story'] }, data }, ['project_id', 'revision', 'action', 'data']), output: saved,
      execute: args => workflow.production.action(args.action, { ...args.data, id: args.project_id, revision: args.revision }) },
    { name: 'project_production_read', description: '读取当前 Scene/Segment 制作请求及精确回写说明。', parameters: schema({ project_id: text, request_id: text }, ['project_id', 'request_id']), output,
      execute: (args, exec) => workflow.production.context(args.project_id, args.request_id, exec?.agent?.session?.id) },
    { name: 'project_production_complete', description: '保存当前制作请求的一批完整 JSON，不提交视频。Segment/分镜/H3 的 data 为 {batch_index,segments}，批次编号按 read 的 request.batch.index，每批最多4项。回执 request 非空时重新 read 并继续，null 时全阶段完成。剧情使用 {text,scenes}；request.plan_segments=true 时每个 scene 必须包含完整 segments 数组，同时完成剧情与片段规划。', parameters: schema({ project_id: text, request_id: text, data }, ['project_id', 'request_id', 'data']), output: saved,
      execute: (args, exec) => workflow.production.complete({ ...args.data, id: args.project_id, request_id: args.request_id }, exec?.agent?.session?.id) },
    { name: 'project_edit_segment', description: '按用户指示修改片段/分镜/H3输入；先 project_read 获取 production.revision。segment 的 data 含 patch；调整片段衔接时由 AI 对比前段结束与当前开始，patch 同时包含 use_previous_tail（布尔值）和 tail_reason（判断原因），第一段必须 false；不要让用户操作开关。shots 含 shots 数组；input 含 prompt/mode/reference_asset_id。不能提交视频。',
      parameters: schema({ project_id: text, segment_id: text, revision: { type: 'integer' }, action: { type: 'string', enum: ['segment', 'shots', 'input'] }, data }, ['project_id', 'segment_id', 'revision', 'action', 'data']), output: saved,
      execute: args => workflow.production.action(args.action, { ...args.data, id: args.project_id, segment_id: args.segment_id, revision: args.revision }) },
  ]
}
