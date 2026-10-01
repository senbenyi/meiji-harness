import { targetNode, emptyCheck, emptyReview, node, aggregateStatus } from './drama-model.js'
// 按原文去重，不把跨镜错误重复复制为每镜意见。
export const uniqueFeedback = values => [...new Set(values.flatMap(value => String(value || '').split(/\r?\n\s*\r?\n/)).map(value => value.trim()).filter(value => value && value !== 'FAIL'))]
export function scopedCheck(check, shotId) {
  if (!shotId || check.passed !== false) return structuredClone(check)
  const failures = uniqueFeedback(check.failures).filter(reason => {
    const ids = reason.match(/\bS\d{2,}\b/g) || []
    return !ids.length || ids.includes(shotId)
  })
  return { ...check, passed: failures.length === 0, failures }
}
export function feedbackKey({ action, track, itemId, slot }) {
  if (action === 'scene-text') return 'scenes'
  if (action === 'character-text') return 'characters'
  if (action === 'episode-generate') return 'summary'
  if (action === 'revise-shot') return `shot:${track}`
  if (action === 'shot-seconds') return `seconds:${track}`
  if (['shot-storyboard', 'storyboard-text', 'storyboard-bind'].includes(action)) return `storyboard:${track}`
  if (action === 'shot-boards') return 'storyboard'
  if (action === 'revise-image' || action === 'image') return `image:${itemId}`
  if (action === 'part-image') return `image:${itemId}:${slot}`
  if (action === 'pencil' || action === 'film') return `${action}:${track}`
  if (action === 'assemble') return 'assembly'
  return action
}
export function emptyFeedback() { return { check: emptyCheck(), review: emptyReview() } }
export function feedbackOf(project, target) {
  const key = typeof target === 'string' ? target : feedbackKey(target)
  if (key === 'seconds') {
    const shots = project.shots?.items || []
    const group = project.shots?.seconds || node('seconds')
    const shared = uniqueFeedback(group.check?.passed === false ? group.check.failures : [])
    const failures = uniqueFeedback(shots.flatMap(shot => shot.seconds.check.passed === false
      ? uniqueFeedback(shot.seconds.check.failures).map(reason => /\bS\d{2,}\b/.test(reason) || shared.includes(reason) ? reason : `${shot.id}：${reason}`) : []))
    const errors = shots.filter(shot => shot.seconds.error).map(shot => `${shot.id}：${shot.seconds.error}`)
    return { ...group, canModify: shots.length > 0 && shots.every(shot => Boolean(shot.seconds.content)), status: group.operation || group.status === 'paused' ? group.status : aggregateStatus(shots.map(shot => shot.seconds)),
      check: { passed: failures.length ? false : shots.length && shots.every(shot => shot.seconds.check.passed === true) ? true : null, failures },
      error: group.error || errors.join('；') || null }
  }
  const record = targetNode(project, key)
  return record || emptyFeedback()
}

// 人工忽略自审（review-override）：只作用于文本内容当前版本的自审不通过。
// 内容为空或格式错误（解析失败）、正在生成、已过期或结论不属于当前版本时不可忽略。
// 放行记在节点 check.override 上（保留原 AI 理由）；内容再次生成或编辑会写入新的 check，放行随之失效。
const overrideKinds = new Set(['summary', 'outline', 'characters', 'scenes', 'shots', 'seconds', 'storyboard'])
export function overrideNodes(project, key) {
  const kind = String(key || '').split(':')[0]
  if (!overrideKinds.has(kind)) return []
  const keys = key === 'outline' ? ['outline', 'characters', 'scenes'] : key === 'seconds' ? ['seconds', ...(project.shots?.items || []).map(shot => `seconds:${shot.id}`)] : [key]
  return keys.map(item => [item, targetNode(project, item)]).filter(([, value]) => value?.check?.passed === false)
}
const hasText = (key, value) => {
  const kind = key.split(':')[0]
  if (kind === 'characters' || kind === 'scenes') return Boolean(value.items ? value.items.length : value.content ?? value.look ?? value.name)
  if (kind === 'shots') return Boolean(value.items?.length) && !value.failedOutput
  if (kind === 'storyboard') return value.content != null
  return Boolean(String(value.content ?? '').trim())
}
export function overrideBlocker(project, key) {
  const nodes = overrideNodes(project, key)
  if (!nodes.length) return '只有自审未通过的文本内容可以忽略'
  for (const [item, value] of nodes) {
    if (value.operation) return '内容正在生成，请稍后'
    if (value.stale) return '内容已过期，请重新生成'
    if (value.check.revision != null && value.check.revision !== value.revision) return '自审结论不属于当前版本，请重新生成'
    if (!hasText(item, value)) return '内容为空或格式错误，不能忽略，请重新生成'
  }
  return null
}
export const overriddenBy = record => record?.check?.passed === true && record.check.override ? record.check.override : null
// 面板是否显示「忽略并通过」按钮（完整校验在服务端 overrideBlocker）。
export const overridable = record => overrideKinds.has(String(record?.id || '').split(':')[0]) && record.check?.passed === false && !record.stale && !record.operation
