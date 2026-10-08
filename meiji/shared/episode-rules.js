// 剧集数据构造、修改及项目/剧集视图转换；无文件 IO。
import { assertDrama, episodeModel, modelPatch, setContent, contentNode } from './drama-model.js'
import { cascade } from './pipeline-cascade.js'
import { aspectRatioOf, durationOf, replaceFrom } from './project-rules.js'

const scriptLimit = 200000
export function normalizeProject(project) {
  if (!project || typeof project !== 'object') return assertDrama(project)
  const { style: _removedStyle, ...withoutStyle } = project
  return assertDrama(withoutStyle)
}
export function materialize(project, episodeId) {
  const episode = project.episodes.find(item => item.id === episodeId)
  if (!episode) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  const ordered = [...project.episodes].reverse()
  const index = ordered.findIndex(item => item.id === episodeId)
  return { ...episode, episodeNumber: index + 1, previousEpisodeOutline: ordered[index - 1]?.plot?.outline?.content, previousEpisodeOutlines: ordered.slice(0, index).map(item => ({ episodeId: item.id, story: item.plot?.outline?.content })).filter(item => item.story), nextEpisodeOutline: ordered[index + 1]?.plot?.outline?.content, id: project.id, episodeId, title: project.title, aspectRatio: project.aspectRatio, outputLanguage: project.outputLanguage, script: project.script, scriptKind: project.scriptKind, mode: project.mode, premise: project.premise, scriptRevision: project.scriptRevision, library: project.library, libraryPendingImages: project.pendingImages, projectSummary: project.summary.content, skills: project.skills, revision: project.revision }
}
export function foldEpisode(project, episodeId, view) {
  const episode = project.episodes.find(item => item.id === episodeId)
  const next = { ...episode }
  for (const key of Object.keys(episode)) if (Object.hasOwn(view, key) && !['id', 'revision'].includes(key)) next[key] = view[key]
  next.revision = episode.revision + 1
  return { episodes: project.episodes.map(item => item.id === episodeId ? modelPatch(episode, next) : item), ...(view.library ? { library: view.library } : {}) }
}

export function episodeSummary(raw) {
  const summary = typeof raw === 'string' ? raw.trim() : ''
  if (!summary) throw Object.assign(new Error('本集剧情摘要必须为非空字符串'), { status: 400 })
  return summary
}

export function blankEpisode(input) {
  const result = episodeModel(crypto.randomUUID(), { createdAt: new Date().toISOString(), cover: null, durationSeconds: durationOf(input?.durationSeconds), summary: typeof input?.summary === 'string' ? input.summary.trim() : '', storyRequirements: String(input?.requirements || '').trim(), stage: 'outline' })
  if (result.summary.content) setContent(result.summary, result.summary.content, { passed: true, failures: [] })
  return result
}

export function addEpisode(project, input) {
  const current = normalizeProject(project)
  return { episodes: [blankEpisode(input), ...current.episodes] }
}

export function editEpisode(project, episodeId, input) {
  const current = normalizeProject(project)
  const episode = current.episodes.find(item => item.id === episodeId)
  if (!episode) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  const durationSeconds = durationOf(input?.durationSeconds)
  const changed = durationSeconds !== episode.durationSeconds
  const next = { ...episode, ...(changed ? replaceFrom(episode, 'summary', {}) : {}), durationSeconds,
    storyRequirements: String(input?.requirements ?? episode.storyRequirements ?? '').trim() }
  return {
    episodes: current.episodes.map(item => item.id === episodeId ? next : item),
  }
}

export function overviewPatch(project, input) {
  if (input?.summary !== undefined || input?.script !== undefined) throw Object.assign(new Error('项目摘要由 AI 更新；剧本请在剧本页编辑'), { status: 400 })
  const title = typeof input?.title === 'string' ? input.title.trim() : project.title
  if (!title || title.length > 100) throw Object.assign(new Error('短剧标题需为 1–100 字'), { status: 400 })
  const storedAspect = project?.aspectRatio || '1344x768'
  const aspectRatio = input?.aspectRatio == null || input.aspectRatio === '' ? storedAspect : aspectRatioOf(input.aspectRatio)
  const changed = aspectRatio !== project.aspectRatio
  return { title, aspectRatio, ...(changed && Array.isArray(project.episodes) ? { episodes: (project.episodes || []).map(episode => ({ ...episode, ...cascade(episode, { type: 'aspect' }).patch })) } : {}) }
}
