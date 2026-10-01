// 摘要长度按非空白 Unicode 字符计数，标点计入；前后端共用。
export const summaryLimit = 300
export const defaultReferenceDuration = 150
export const summaryLength = text => Array.from(String(text || '').replace(/\s/gu, '')).length
export function referenceDuration(value = defaultReferenceDuration) {
  if (!Number.isInteger(value) || value < 1 || value > 86400) throw Object.assign(new Error('参考时长需为 1–86400 的整数秒'), { status: 400 })
  return value
}
export function durationRange(value) {
  const reference = referenceDuration(value)
  return { min: Math.max(1, reference - 20), max: Math.min(86400, reference + 20) }
}
export function episodeSummaryFailures(draft, reference) {
  const failures = []
  if (typeof draft?.summary !== 'string' || !summaryLength(draft.summary) || summaryLength(draft.summary) > summaryLimit) failures.push('本集剧情摘要必须非空且不超过 300 字（不计空白，标点计入）')
  const { min, max } = durationRange(reference)
  if (!Number.isInteger(draft?.durationSeconds) || draft.durationSeconds < min || draft.durationSeconds > max) failures.push(`本集时长必须为 ${min}–${max} 秒的整数，参考时长为 ${reference} 秒`)
  return failures
}
