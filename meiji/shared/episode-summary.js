// 摘要长度按非空白 Unicode 字符计数，标点计入；前后端共用。
export const summaryLimit = 300
export const defaultReferenceDuration = 150
export const summaryLength = text => Array.from(String(text || '').replace(/\s/gu, '')).length
export function referenceDuration(value = defaultReferenceDuration) {
  if (!Number.isInteger(value) || value < 1 || value > 86400) throw Object.assign(new Error('参考时长需为 1–86400 的整数秒'), { status: 400 })
  return value
}
// 本集时长由用户设定，摘要只按该时长设计剧情容量；模型不输出、也不修改时长。
export function episodeSummaryFailures(draft) {
  const failures = []
  if (typeof draft?.summary !== 'string' || !summaryLength(draft.summary) || summaryLength(draft.summary) > summaryLimit) failures.push('本集剧情摘要必须非空且不超过 300 字（不计空白，标点计入）')
  return failures
}
