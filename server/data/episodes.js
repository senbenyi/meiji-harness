import { migrateFeedback } from './feedback-migration.js'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { aspectRatioOf, durationOf, replaceFrom, sourcePatch, staleMedia } from '../flow/gates.js'
import { imageAssets, pictureRecord } from '../generate/image.js'

const scriptLimit = 200000

function mapPictures(bag) {
  if (!bag?.items) return bag ?? null
  return { ...bag, items: bag.items.map(item => pictureRecord(item)) }
}

function mapCharacters(bag) {
  if (!bag?.items) return bag ?? null
  return {
    ...bag,
    items: bag.items.map(item => {
      const next = pictureRecord(item)
      const { characterType, ...rest } = next
      return {
        ...rest,
        nationality: rest.nationality || '中国',
        clothes: imageAssets(rest.clothes),
        props: imageAssets(rest.props),
        hairstyles: imageAssets(rest.hairstyles),
      }
    }),
  }
}

export function normalizeProject(project) {
  const script = typeof project?.script === 'string' ? project.script : ''
  const base = Array.isArray(project?.episodes) ? { ...project, script } : {
    ...project,
    script,
    episodes: [episodeFromProject(migrateFeedback(project))],
  }
  return {
    ...migrateFeedback(base),
    episodes: (base.episodes || []).map(episode => migrateFeedback({
      ...episode,
      characters: mapCharacters(episode.characters),
      scenes: mapPictures(episode.scenes),
    })),
  }
}

function episodeFromProject(project) {
  return {
    id: project.id,
    createdAt: project.createdAt,
    cover: null,
    durationSeconds: project.durationSeconds,
    summary: project.summary,
    stage: project.stage || 'brief',
    feedback: project.feedback || {},
    brief: project.brief ?? null,
    outline: project.outline ?? null,
    characters: project.characters ?? null,
    scenes: project.scenes ?? null,
    shots: project.shots ?? null,
    storyboard: project.storyboard ?? null,
    films: project.films || {},
    boards: project.boards || {},
    pendingImages: project.pendingImages || {},
    assembly: project.assembly ?? null,
    activity: project.activity ?? null,
    activityError: project.activityError ?? null,
    status: project.status || 'in-progress',
  }
}

export function materialize(project, episodeId) {
  const current = normalizeProject(project)
  const episode = current.episodes.find(item => item.id === episodeId)
  if (!episode) throw Object.assign(new Error('这一集不存在'), { status: 404 })
  return {
    id: current.id,
    title: current.title,
    aspectRatio: current.aspectRatio,
    style: current.style,
    outputLanguage: current.outputLanguage || 'zh-CN',
    revision: current.revision || 0,
    summary: episode.summary,
    projectSummary: current.summary,
    script: current.script,
    durationSeconds: episode.durationSeconds,
    episodeId: episode.id,
    cover: episode.cover,
    stage: episode.stage,
    feedback: episode.feedback || {},
    customSkills: episode.customSkills || {},
    brief: episode.brief,
    outline: episode.outline,
    characters: episode.characters,
    scenes: episode.scenes,
    shots: episode.shots,
    storyboard: episode.storyboard,
    films: episode.films || {},
    boards: episode.boards || {},
    pendingImages: episode.pendingImages || {},
    assembly: episode.assembly ?? null,
    activity: episode.activity,
    activityError: episode.activityError,
    status: episode.status,
    workflow: current.workflow,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  }
}

export function foldEpisode(project, episodeId, view) {
  const current = normalizeProject(project)
  const episodes = current.episodes.map(episode => episode.id !== episodeId ? episode : {
    ...episode,
    durationSeconds: view.durationSeconds,
    summary: view.summary,
    stage: view.stage,
    feedback: view.feedback || {},
    customSkills: view.customSkills || {},
    brief: view.brief,
    outline: view.outline,
    characters: view.characters,
    scenes: view.scenes,
    shots: view.shots,
    storyboard: view.storyboard,
    films: view.films || {},
    boards: view.boards || {},
    pendingImages: view.pendingImages || {},
    assembly: view.assembly ?? null,
    activity: view.activity ?? null,
    activityError: view.activityError ?? null,
    status: view.status || episode.status,
  })
  return {
    episodes,
    activity: view.activity ?? null,
    activityError: view.activityError ?? null,
    title: view.title || current.title,
    aspectRatio: view.aspectRatio || current.aspectRatio,
  }
}

function episodeSummary(raw) {
  const summary = typeof raw === 'string' ? raw.trim() : ''
  if (!summary || summary.length > 10000) throw Object.assign(new Error('本集剧情摘要需为 1–10000 字'), { status: 400 })
  return summary
}

export function blankEpisode(input) {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    cover: null,
    durationSeconds: durationOf(input?.durationSeconds),
    summary: episodeSummary(input?.summary),
    stage: 'brief',
    feedback: {},
    brief: null,
    outline: null,
    characters: null,
    scenes: null,
    shots: null,
    storyboard: null,
    films: {},
    boards: {},
    assembly: null,
    activity: null,
    activityError: null,
    status: 'in-progress',
  }
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
  const changed = summary !== episode.summary || durationSeconds !== episode.durationSeconds
  const next = changed
    ? { ...episode, ...replaceFrom(episode, 'brief', { brief: null }), summary, durationSeconds }
    : { ...episode, summary, durationSeconds }
  return {
    episodes: current.episodes.map(item => item.id === episodeId ? next : item),
  }
}

export function overviewPatch(project, input) {
  const summary = typeof input?.summary === 'string' ? input.summary.trim() : (typeof project?.summary === 'string' ? project.summary.trim() : '')
  if (!summary || summary.length > 10000) throw Object.assign(new Error('摘要需为 1–10000 字'), { status: 400 })
  const title = typeof input?.title === 'string' ? input.title.trim() : project.title
  if (!title || title.length > 100) throw Object.assign(new Error('短剧标题需为 1–100 字'), { status: 400 })
  const script = typeof input?.script === 'string' ? input.script.trim() : (typeof project?.script === 'string' ? project.script.trim() : '')
  if (script.length > scriptLimit) throw Object.assign(new Error('剧本过长'), { status: 400 })
  const storedAspect = project?.aspectRatio || '1344x768'
  const aspectRatio = input?.aspectRatio == null || input.aspectRatio === '' ? storedAspect : aspectRatioOf(input.aspectRatio)
  const style = typeof input?.style === 'string' ? input.style.trim() : (typeof project?.style === 'string' ? project.style.trim() : '')
  if (style.length > 120) throw Object.assign(new Error('风格需为 1–120 字'), { status: 400 })
  const changed = summary !== project.summary || script !== project.script || aspectRatio !== project.aspectRatio || style !== project.style
  return { title, summary, script, aspectRatio, style, ...(changed && Array.isArray(project.episodes) ? { episodes: (project.episodes || []).map(episode => ({ ...episode, ...staleMedia(episode) })) } : {}) }
}

export function scopeProjects(store, episodeId) {
  return {
    async read(id) {
      return materialize(await store.read(id), episodeId)
    },
    async save(id, patch) {
      const saved = await store.save(id, current => {
        const view = materialize(current, episodeId)
        const changes = typeof patch === 'function' ? patch(view) : patch
        return foldEpisode(current, episodeId, { ...view, ...changes })
      })
      return materialize(saved, episodeId)
    },
    async writeStep(id, step, data) {
      return this.save(id, view => replaceFrom(view, step, data))
    },
    async saveSource(id, input) {
      return this.save(id, view => sourcePatch(view, input))
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
