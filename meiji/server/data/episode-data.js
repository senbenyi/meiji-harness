// 剧集存储视图和封面文件读写；数据规则位于 shared/episode-rules.js。
import { materialize, foldEpisode, episodeSummary } from '../../shared/episode-rules.js'
import { replaceFrom, sourcePatch } from '../../shared/project-rules.js'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'

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
    async writeStep(id, step, data, options) {
      return this.save(id, view => replaceFrom(view, step, data), options)
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
