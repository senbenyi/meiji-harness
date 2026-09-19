// 职责：定义完整 JSON 批次的进度、身份和幂等回执，隔离暂存数据与模型上下文。
import { createHash } from 'node:crypto'
import { fail, stageRun } from '../../database/schemas/production.js'

export const batchSize = 4
export const batchHash = body => createHash('sha256').update(JSON.stringify(body.segments)).digest('hex')
export const batchState = request => request.batch || { index: 0, items: [], hashes: [] }

export function batchRequest(request) {
  if (!request || request.stage === 'story') return request
  const batch = batchState(request)
  return { ...request, segment_ids: request.segment_ids.slice(batch.items.length, batch.items.length + batchSize),
    batch: { index: batch.index, max_items: batchSize, saved_items: batch.items.length } }
}

export function checkBatch(request, body) {
  const batch = batchState(request)
  if (!Number.isInteger(body.batch_index) || body.batch_index < 0) fail('请填写 read 返回的 batch_index，不能续写残缺 JSON')
  if (!Array.isArray(body.segments) || !body.segments.length || body.segments.length > batchSize) fail(`每批需要 1～${batchSize} 个完整条目`)
  const hash = batchHash(body)
  if (body.batch_index < batch.index && batch.hashes[body.batch_index] === hash) return { duplicate: true }
  if (body.batch_index !== batch.index) fail(`批次过期、冲突或顺序错误，请重新 read；batch_index 必须为 ${batch.index}（第 ${batch.index + 1} 批），不能自行加一`)
  return { ...batch, hash }
}

export function retainBatch(p, request, batch, items, done) {
  const hashes = [...batch.hashes, batch.hash]
  stageRun(p, request.stage, done ? 'succeeded' : 'running')
  if (done) {
    p.completed_request = { id: request.id, session_id: request.session_id, revision: p.revision + 1, hashes }
    p.stage = request.stage; p.request = null
  } else {
    p.request = { ...request, batch: { index: batch.index + 1, items, hashes }, revision: p.revision + 1 }
  }
}

export const batchInstructions = `\n\n## 分批回写协议
本阶段分批生成；以上全量数量和总时长要求针对最终合并结果。本次只返回 data:{batch_index:request.batch.index,segments:[完整条目]}，每批最多 ${batchSize} 项，不返回半截 JSON、不重复已经保存的条目。
batch_index 从 0 开始，直接照抄本次 request.batch.index 数值，不能自行加一；例如 index=1 时返回 batch_index:1。
Segment 规划按 remaining_scenes 的顺序继续未完成时长，previous_segment 是已保存前一段；不得因批次边界强加 Scene 或镜头切换。
未完成的 Scene 至少留出 4 秒供下一批生成，不能留下不足 4 秒的零头；所有批次合计最多 100 段。
规划新 Segment 时省略 id，由系统生成永久 ID；不要复用 previous_segment.id 或 saved_segment_ids。人物数量和七类 materials 必须逐项完整填写，不能用省略号或引用上一批代替字段。
分镜和 H3 输入必须原样、按序覆盖本次 request.segment_ids。
每次 complete 后检查回执：request 非空时立即重新 project_production_read 获取下一批，继续同阶段；request 为 null 才表示全阶段合并完成并停止。中断后重新 read 从已保存进度恢复，不重新生成前面的批次。`
