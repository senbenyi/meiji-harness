import { GenerationStatus, node, episodeModel, contentNode } from './drama-model.js'

export function replaceFrom(project, step, data) {
  let next = structuredClone(project)
  if (['summary', 'outline'].includes(step)) {
    if (step === 'summary') next.plot = episodeModel('temporary', {}).plot
    next.shots = { ...node('shots'), items: [] }
  }
  if (['shots', 'storyboard'].includes(step)) next = { ...next, ...clearShotDownstream(next, step === 'shots' ? 'shots' : 'storyboard') }
  next.assembly = node('assembly')
  next.pendingImages = {}
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
  return { ...replaceFrom(project, 'summary', {}), summary: contentNode(project.summary, summary, { passed: true, failures: [] }), title, durationSeconds, aspectRatio }
}


export function staleMedia(project) {
  const shots = structuredClone(project.shots)
  for (const shot of shots.items) {
    if (shot.video.content) { shot.video.stale = true; shot.video.status = GenerationStatus.FAILED }
    if (shot.pencil.content) { shot.pencil.stale = true; shot.pencil.status = GenerationStatus.FAILED }
  }
  const assembly = structuredClone(project.assembly)
  if (assembly.content) { assembly.stale = true; assembly.status = GenerationStatus.FAILED }
  return { shots, assembly }
}
export function clearShotDownstream(project, stage, track) {
  const shots = structuredClone(project.shots)
  const kinds = stage === 'shots' ? ['seconds', 'storyboard', 'pencil', 'video'] : stage === 'seconds' ? ['storyboard', 'pencil', 'video'] : ['pencil', 'video']
  for (const shot of shots.items) {
    if (track && shot.id !== track) continue
    shot.tailFrame = node(`tailFrame:${shot.id}`)
    for (const kind of kinds) shot[kind] = node(`${kind === 'video' ? 'film' : kind}:${shot.id}`)
  }
  return { shots, assembly: node('assembly'), pendingImages: Object.fromEntries(Object.entries(project.pendingImages || {}).filter(([, draft]) => !draft.track || (track && draft.track !== track))) }
}
