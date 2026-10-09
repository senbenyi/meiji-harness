// 小段是故事单位；时长为正整数秒，不受单镜15秒限制。
export function outlineFailures(value, durationSeconds) {
  if (!Array.isArray(value) || !value.length) return ['大纲必须为非空 JSON 数组']
  const failures = []
  value.forEach((part, index) => {
    if (!part || typeof part !== 'object' || Array.isArray(part) || Object.keys(part).length !== 3 || !['编号', '时长秒', '正文'].every(key => Object.hasOwn(part, key))) {
      failures.push(`故事小段 ${index + 1} 必须仅含编号、时长秒、正文`); return
    }
    if (part.编号 !== index + 1) failures.push('故事小段编号必须从1开始连续递增')
    if (!Number.isInteger(part.时长秒) || part.时长秒 <= 0) failures.push(`故事小段 ${index + 1} 的时长秒必须为正整数`)
    if (typeof part.正文 !== 'string' || !part.正文.trim()) failures.push(`故事小段 ${index + 1} 的正文必须为非空字符串`)
  })
  if (!failures.length && Number.isInteger(durationSeconds) && durationSeconds > 0) {
    const total = value.reduce((sum, part) => sum + part.时长秒, 0)
    const min = Math.max(1, durationSeconds - 10), max = durationSeconds + 10
    if (total < min || total > max) failures.push(`故事小段总时长 ${total} 秒，剧集目标 ${durationSeconds} 秒，允许 ${min}–${max} 秒；请按原事件重新分配各段时长和有效内容，保留完整剧情与结尾，输出完整故事小段数组`)
  }
  return failures
}

export function normalizeOutline(value, status = 502, durationSeconds) {
  const failures = outlineFailures(value, durationSeconds)
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { status })
  return value.map(part => ({ 编号: part.编号, 时长秒: part.时长秒, 正文: part.正文.trim() }))
}

export function outlineText(value) {
  if (!Array.isArray(value)) return ''
  const total = value.reduce((sum, part) => sum + part.时长秒, 0)
  return `${value.map(part => `${part.编号}.（${part.时长秒}秒）${part.正文}`).join('\n\n')}\n\n总时长：${total}秒`
}
