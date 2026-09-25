import { reviewSteps } from '../../client/flow-rules.js'
export { reviewSteps, reviewsOf, hasBrief, hasOutline, hasCharacters, hasScenes, hasShots, shotsReady, hasShotSeconds, hasStoryboard, hasFilm, gateOf, canGenerate, gateMessage } from '../../client/flow-rules.js'

export function replaceFrom(project, step, data) {
  const index = reviewSteps.indexOf(step)
  if (index < 0) throw Object.assign(new Error('步骤无效'), { status: 400 })
  const feedback = structuredClone(project.feedback || {})
  const stages = { summary: 'brief', shot: 'shots', seconds: 'shots', image: 'characters', pencil: 'storyboard', films: 'film', assembly: 'film' }
  for (const key of Object.keys(feedback)) {
    const name = key.split(':')[0]
    const owner = name === 'image' && project.scenes?.items?.some(item => item.id === key.split(':')[1]) ? 'scenes' : (stages[name] || name)
    if (reviewSteps.indexOf(owner) > index) delete feedback[key]
  }
  return {
    brief: index >= 1 ? project.brief : null,
    outline: index >= 2 ? project.outline : null,
    characters: index >= 3 ? project.characters : null,
    scenes: index >= 4 ? project.scenes : null,
    shots: index >= 5 ? project.shots : null,
    storyboard: index >= 6 ? project.storyboard : null,
    films: {},
    boards: {},
    pendingImages: {},
    assembly: null,
    ...data,
    stage: step,
    feedback,
    status: 'in-progress',
  }
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

export function sourcePatch(project, input) {
  const summary = typeof input?.summary === 'string' ? input.summary.trim() : (typeof project?.summary === 'string' ? project.summary.trim() : '')
  if (!summary || summary.length > 10000) throw Object.assign(new Error('剧本摘要需为 1–10000 字'), { status: 400 })
  const title = typeof input?.title === 'string' ? input.title.trim() : project.title
  if (!title || title.length > 100) throw Object.assign(new Error('短剧标题需为 1–100 字'), { status: 400 })
  const durationSeconds = input?.durationSeconds == null || input.durationSeconds === ''
    ? project.durationSeconds
    : durationOf(input.durationSeconds)
  const storedAspect = project?.aspectRatio || defaultAspectRatio
  const aspectRatio = input?.aspectRatio == null || input.aspectRatio === '' ? storedAspect : aspectRatioOf(input.aspectRatio)
  const changed = summary !== project.summary || durationSeconds !== project.durationSeconds || aspectRatio !== storedAspect
  if (!changed) return title === project.title ? { summary } : { summary, title }
  return { summary, title, durationSeconds, aspectRatio, ...replaceFrom(project, 'brief', { brief: null }) }
}


export function staleMedia(project) {
  return {
    films: Object.fromEntries(Object.entries(project.films || {}).map(([id, film]) => [id, { ...film, status: 'stale' }])),
    boards: {},
    pendingImages: {},
    assembly: project.assembly ? { ...project.assembly, status: 'stale' } : null,
    status: 'in-progress',
  }
}

export function clearShotDownstream(project, stage, track) {
  const selected = id => !track || id === track
  const clearSeconds = stage === 'shots' || stage === 'seconds'
  const feedback = structuredClone(project.feedback || {})
  for (const key of Object.keys(feedback)) {
    const [kind, id] = key.split(':')
    if (!selected(id)) continue
    if (['pencil', 'film'].includes(kind) || (kind === 'storyboard' && clearSeconds) || (kind === 'seconds' && stage === 'shots')) delete feedback[key]
  }
  delete feedback.assembly
  return {
    ...(clearSeconds && project.shots ? { shots: { ...project.shots, items: project.shots.items.map(item => selected(item.id) ? { ...item, seconds: [], secondsText: '' } : item) } } : {}),
    storyboard: (project.storyboard || []).filter(item => !selected(item.id)),
    boards: Object.fromEntries(Object.entries(project.boards || {}).filter(([id]) => !selected(id))),
    films: Object.fromEntries(Object.entries(project.films || {}).filter(([id]) => !selected(id))),
    pendingImages: Object.fromEntries(Object.entries(project.pendingImages || {}).filter(([, draft]) => !draft.track || !selected(draft.track))),
    assembly: null,
    feedback,
  }
}
