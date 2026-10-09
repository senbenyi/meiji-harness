import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { projectStore } from './project-store.js'
import { node } from '../models/data/drama-model.js'

const safeId = /^[A-Za-z0-9_-]{1,128}$/
const sceneDraft = (draft, ids, variants) => draft.category === 'scenes' || draft.libraryKind === 'scenes' || ids.has(draft.itemId) || variants.has(draft.variantId)

// 仅在服务启动、遗留执行标记已清理后执行；先提交数据删除，再清理图片文件。
export async function removeSceneData(home) {
  const store = projectStore(home), draftIds = new Set(), legacyImages = []
  let changed = 0
  for (const project of await store.list()) {
    const variants = new Set((project.library.scenes || []).flatMap(entry => entry.variants.map(variant => variant.id)))
    const needsCleanup = project.library.scenes.length || Object.values(project.pendingImages || {}).some(draft => sceneDraft(draft, new Set(), variants))
      || project.episodes.some(episode => episode.plot.scenes.items.length || episode.plot.scenes.source || episode.plot.scenes.operation
        || Object.values(episode.pendingImages || {}).some(draft => sceneDraft(draft, new Set(), variants)) || episode.shots.items.some(shot => shot.scene))
    if (!needsCleanup) continue
    await store.save(project.id, current => {
      const variants = new Set(current.library.scenes.flatMap(entry => entry.variants.map(variant => variant.id)))
      const keepDrafts = (drafts, ids) => Object.fromEntries(Object.entries(drafts || {}).filter(([id, draft]) => {
        if (!sceneDraft(draft, ids, variants)) return true
        draftIds.add(id); return false
      }))
      current.pendingImages = keepDrafts(current.pendingImages, new Set())
      current.library.scenes = []
      for (const episode of current.episodes) {
        const ids = new Set(episode.plot.scenes.items.map(item => item.id))
        for (const id of ids) if (safeId.test(id)) legacyImages.push(join(home, 'storages', 'meiji', 'projects', project.id, 'images', episode.id, id))
        episode.pendingImages = keepDrafts(episode.pendingImages, ids)
        episode.plot.scenes = { ...node('scenes'), revision: episode.plot.scenes.revision + 1, items: [] }
        for (const shot of episode.shots.items) shot.scene = ''
      }
      return current
    })
    changed++
  }
  const draftsRoot = join(home, 'storages', 'meiji', 'image-drafts')
  let entries = []
  try { entries = await readdir(draftsRoot) } catch (error) { if (error.code !== 'ENOENT') throw error }
  // 同时删除已无项目引用的场景候选；文件系统错误不能被当作成功。
  for (const id of entries.filter(id => safeId.test(id))) {
    try {
      const metadata = JSON.parse(await readFile(join(draftsRoot, id, 'metadata.json'), 'utf8'))
      if (metadata.category === 'scenes') draftIds.add(id)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  for (const id of draftIds) if (safeId.test(id)) await rm(join(draftsRoot, id), { recursive: true, force: true })
  for (const base of legacyImages) for (const suffix of ['png', 'jpg', 'jpeg', 'webp', 'job.json']) await rm(`${base}.${suffix}`, { force: true })
  await rm(join(home, 'storages', 'meiji', 'assets', 'scenes'), { recursive: true, force: true })
  return { changedProjects: changed }
}
