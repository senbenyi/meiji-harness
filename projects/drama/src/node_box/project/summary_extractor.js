import { parseNodeOutput } from '../../node_runtime/output_response_parser.js'
import { runBoxModelTurn } from '../../node_runtime/box_model_runner.js'

/** 展示摘要按需读取规则与原稿；每轮独立Step，无额外内容审核。 */
export async function extractOriginalSummary(ctx, { originalScript, models, records }) {
  const config = await models.read()
  const input = { original_script: originalScript, output_language: config.output_language }
  const record = async (transfer, options) => {
    transfer.title = '项目管理 · 提取剧本摘要与预估时长'
    try { transfer.id = ctx.recordHttp(transfer, options) || transfer.id }
    catch (error) {
      if (error.code === 'STEP_CLOSED' && transfer.id) await records.http.record(transfer, options)
      throw error
    }
    await records.http.record(transfer, options)
  }
  return runBoxModelTurn({ ctx, nodeType: 'project', action: 'generate', input, goal: '提取原稿展示摘要并估计完整表演时长', config, record,
    maxOutputRepairs: 0,
    validate: value => { const output = parseNodeOutput('basic_info', 'generate', value); output.summary = output.summary.trim(); return output },
  })
}
