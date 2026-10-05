import { cascade } from './pipeline-cascade.js'
import { contentNode } from './drama-model.js'

export function replaceFrom(project, step, data) {
  const type = { summary: 'summary', outline: 'outline', shots: 'shots', storyboard: 'storyboard' }[step]
  const next = type ? { ...project, ...cascade(project, { type }).patch } : project
  return { ...next, ...data, stage: step }
}

export function durationOf(raw) {
  const durationSeconds = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) {
    throw Object.assign(new Error('时长需为 1–86400 的整数秒'), { status: 400 })
  }
  return durationSeconds
}

export const defaultAspectRatio = '1344x768'
const aspectRatios = ['1344x768', '768x1344']
const legacyAspect = { '16:9': '1344x768', '9:16': '768x1344' }

export function aspectRatioOf(raw) {
  if (raw == null || raw === '') return defaultAspectRatio
  const value = legacyAspect[String(raw).trim()] || String(raw).trim()
  if (!aspectRatios.includes(value)) throw Object.assign(new Error('画幅需为 1344x768 或 768x1344'), { status: 400 })
  return value
}

// 视频请求尺寸按项目画幅：宽高为 32 的倍数，总像素在网关上限（864×1184）以内。
const videoSizes = { '1344x768': '1024x576', '768x1344': '576x1024' }
export function videoSizeOf(raw) {
  return videoSizes[aspectRatioOf(raw)]
}

export function sourcePatch(project, input) {
  const summary = typeof input?.summary === 'string' ? input.summary.trim() : (typeof project?.summary?.content === 'string' ? project.summary.content.trim() : '')
  if (!summary) throw Object.assign(new Error('摘要不能为空'), { status: 400 })
  if (!project.episodeId && summary.length > 10000) throw Object.assign(new Error('剧本摘要需为 1–10000 字'), { status: 400 })
  const title = typeof input?.title === 'string' ? input.title.trim() : project.title
  if (!title || title.length > 100) throw Object.assign(new Error('短剧标题需为 1–100 字'), { status: 400 })
  const durationSeconds = input?.durationSeconds == null || input.durationSeconds === ''
    ? project.durationSeconds
    : durationOf(input.durationSeconds)
  const storedAspect = project?.aspectRatio || defaultAspectRatio
  const aspectRatio = input?.aspectRatio == null || input.aspectRatio === '' ? storedAspect : aspectRatioOf(input.aspectRatio)
  const changed = summary !== project.summary.content || durationSeconds !== project.durationSeconds || aspectRatio !== storedAspect
  if (!changed) return title === project.title ? { summary: project.summary } : { summary: project.summary, title }
  const patch = summary !== project.summary.content || durationSeconds !== project.durationSeconds
    ? replaceFrom(project, 'summary', {}) : cascade(project, { type: 'aspect' }).patch
  return { ...patch, summary: contentNode(project.summary, summary, { passed: true, failures: [] }), title, durationSeconds, aspectRatio }
}


export function clearShotDownstream(project, stage, track) {
  return cascade(project, { type: stage === 'shots' ? track ? 'shot' : 'shots' : stage === 'seconds' ? 'seconds' : 'storyboard', track }).patch
}
