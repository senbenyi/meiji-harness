import { summaryLength, summaryLimit } from '../../shared/episode-summary.js'
import { assertDrama, episodeModel, modelPatch, setContent, contentNode } from '../../shared/drama-model.js'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { aspectRatioOf, durationOf, replaceFrom, sourcePatch, staleMedia } from '../../shared/project-rules.js'

const scriptLimit = 200000
export function normalizeProject(project) { return assertDrama(project) }
export function materialize(project, episodeId) {
  const episode = project.episodes.find(item => item.id === episodeId)
  if (!episode) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  const ordered = [...project.episodes].reverse()
  const index = ordered.findIndex(item => item.id === episodeId)
  return { ...episode, episodeNumber: index + 1, previousEpisodeSummary: ordered[index - 1]?.summary?.content, nextEpisodeSummary: ordered[index + 1]?.summary?.content, id: project.id, episodeId, title: project.title, aspectRatio: project.aspectRatio, style: project.style, outputLanguage: project.outputLanguage, script: project.script, projectSummary: project.summary.content, skills: project.skills, revision: project.revision }
}
export function foldEpisode(project, episodeId, view) {
  const episode = project.episodes.find(item => item.id === episodeId)
  const next = { ...episode }
  for (const key of Object.keys(episode)) if (Object.hasOwn(view, key) && !['id', 'revision'].includes(key)) next[key] = view[key]
  next.revision = episode.revision + 1
  return { episodes: project.episodes.map(item => item.id === episodeId ? modelPatch(episode, next) : item), activity: view.activity ?? null, activityError: view.activityError ?? null }
}

function episodeSummary(raw) {
  const summary = typeof raw === 'string' ? raw.trim() : ''
  if (!summary || summaryLength(summary) > summaryLimit) throw Object.assign(new Error('本集剧情摘要需为 1–300 字（不计空白，标点计入）'), { status: 400 })
  return summary
}

export function blankEpisode(input) {
  const result = episodeModel(randomUUID(), { createdAt: new Date().toISOString(), cover: null, durationSeconds: durationOf(input?.durationSeconds), summary: episodeSummary(input?.summary), stage: 'summary' })
  setContent(result.summary, result.summary.content, { passed: true, failures: [] })
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
  const summary = episodeSummary(input?.summary)
  const durationSeconds = durationOf(input?.durationSeconds)
  const changed = summary !== episode.summary.content || durationSeconds !== episode.durationSeconds
  const next = changed
    ? { ...episode, ...replaceFrom(episode, 'summary', {}), summary: contentNode(episode.summary, summary, { passed: true, failures: [] }), durationSeconds }
    : { ...episode, summary: contentNode(episode.summary, summary, { passed: true, failures: [] }), durationSeconds }
  return {
    episodes: current.episodes.map(item => item.id === episodeId ? next : item),
  }
}

export function overviewPatch(project, input) {
  const summary = typeof input?.summary === 'string' ? input.summary.trim() : (typeof project?.summary?.content === 'string' ? project.summary.content.trim() : '')
  if (!summary || summary.length > 10000) throw Object.assign(new Error('摘要需为 1–10000 字'), { status: 400 })
  const title = typeof input?.title === 'string' ? input.title.trim() : project.title
  if (!title || title.length > 100) throw Object.assign(new Error('短剧标题需为 1–100 字'), { status: 400 })
  const script = typeof input?.script === 'string' ? input.script.trim() : (typeof project?.script === 'string' ? project.script.trim() : '')
  if (script.length > scriptLimit) throw Object.assign(new Error('剧本过长'), { status: 400 })
  const storedAspect = project?.aspectRatio || '1344x768'
  const aspectRatio = input?.aspectRatio == null || input.aspectRatio === '' ? storedAspect : aspectRatioOf(input.aspectRatio)
  const style = typeof input?.style === 'string' ? input.style.trim() : (typeof project?.style === 'string' ? project.style.trim() : '')
  if (style.length > 120) throw Object.assign(new Error('风格需为 1–120 字'), { status: 400 })
  const changed = summary !== project.summary.content || script !== project.script || aspectRatio !== project.aspectRatio || style !== project.style
  return { title, summary: contentNode(project.summary, summary, { passed: true, failures: [] }), script, aspectRatio, style, ...(changed && Array.isArray(project.episodes) ? { episodes: (project.episodes || []).map(episode => ({ ...episode, ...staleMedia(episode) })) } : {}) }
}

export function scopeProjects(store, episodeId, track) {
  return {
    async read(id) {
      return materialize(await store.read(id), episodeId)
    },
    async save(id, patch) {
      const saved = await store.save(id, current => {
        const view = materialize(current, episodeId)
        const changes = typeof patch === 'function' ? patch(view) : patch
        const next = { ...view, ...changes }
        if (track && changes.shots) next.shots = { ...view.shots, items: view.shots.items.map(shot => shot.id === track ? changes.shots.items.find(item => item.id === track) || shot : shot) }
        return foldEpisode(current, episodeId, next)
      })
      return materialize(saved, episodeId)
    },
    async writeStep(id, step, data) {
      return this.save(id, view => replaceFrom(view, step, data))
    },
    async saveSource(id, input) {
      return this.save(id, view => sourcePatch(view, { ...input, summary: episodeSummary(input?.summary ?? view.summary.content) }))
    },
  }
}

const coverTypes = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }

export async function writeEpisodeCover(home, projectId, episodeId, sourceFile, mime) {
  const ext = coverTypes[mime]
  if (!ext) throw Object.assign(new Error('封面需为 png、jpeg 或 webp'), { status: 400 })
  const directory = join(home, 'storages', 'meiji', 'projects', projectId, 'covers')
  await mkdir(directory, { recursive: true })
  for (const name of await readdir(directory).catch(() => [])) {
    if (name.startsWith(episodeId + '.')) await rm(join(directory, name), { force: true })
  }
  await copyFile(sourceFile, join(directory, episodeId + ext))
  return `/plugins/meiji/projects/${projectId}/covers/${episodeId}`
}

export async function readEpisodeCover(home, projectId, episodeId) {
  const directory = join(home, 'storages', 'meiji', 'projects', projectId, 'covers')
  const name = (await readdir(directory)).find(item => item.startsWith(episodeId + '.'))
  if (!name) {
    const error = new Error('封面不存在')
    error.code = 'ENOENT'
    throw error
  }
  const ext = extname(name)
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
  return { bytes: await readFile(join(directory, name)), mime }
}
