import { outlineFailures } from './story-outline.js'

// 镜头表继承小段预算；±10秒已在大纲阶段校验，本阶段不重新分配整集时长。
export function shotTableBudget(outline) {
  const parts = (outline || []).map(part => ({ number: part.编号, durationSeconds: part.时长秒, minShots: Math.ceil(part.时长秒 / 15) }))
  const target = parts.reduce((sum, part) => sum + part.durationSeconds, 0)
  return { target, min: target, max: target, minShots: parts.reduce((sum, part) => sum + part.minShots, 0), parts }
}

export function shotTableTiming(durations, episodeDuration, outline) {
  const sourceFailures = outlineFailures(outline, episodeDuration)
  const total = durations.reduce((sum, duration) => sum + duration, 0), count = durations.length
  if (sourceFailures.length) return { count, total, failures: sourceFailures.map(reason => `请先修正大纲：${reason}`) }
  const budget = shotTableBudget(outline), failures = [], ranges = []
  let index = 0
  for (const part of budget.parts) {
    const start = index; let seconds = 0
    while (index < count && seconds < part.durationSeconds) seconds += durations[index++]
    const range = start === index ? '无镜头' : `S${String(start + 1).padStart(2, '0')}–S${String(index).padStart(2, '0')}`
    ranges.push({ ...part, range, actualSeconds: seconds })
    if (seconds !== part.durationSeconds) {
      failures.push(`故事小段 ${part.number} 的固定时长为 ${part.durationSeconds} 秒，当前 ${range} 累计 ${seconds} 秒，未在该段边界结束。请从该段起在原正文内部重新拆镜，每镜1–15秒，各段镜头合计必须精确等于对应小段时长，不跨段借秒、不新增或删除剧情。`)
      break
    }
  }
  if (!failures.length && index < count) failures.push('大纲所有小段已经结束，但仍有额外镜头；请删除结尾之后追加的内容，保留原结尾。')
  if (total !== budget.target) failures.push(`当前镜头表共 ${count} 镜，总时长 ${total} 秒；大纲固定总时长 ${budget.target} 秒，相差 ${Math.abs(total - budget.target)} 秒。请按各小段既定预算重新拆镜，不扩写补时或删减剧情，输出完整连续编号的镜头表。`)
  return { ...budget, count, total, ranges, failures }
}
