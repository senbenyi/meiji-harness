// 项目存储布局 v2（只有本模块了解文件结构）：
//   projects/<id>.json                               项目索引：layout: 2，episodes 只存 { id, file }
//   projects/<id>/episodes/<episodeId>.<版本>.json   每集一个文件
// 保存：内容变化的剧集写成新版本文件 → 原子替换索引（提交点）→ 删除不再被引用的旧文件。
// 中途失败时索引仍指向旧文件，项目保持一致；读取时若剧集文件已被新版本替换，重读索引。
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

export const LAYOUT = 2
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const safeId = /^[\w-]{1,128}$/

export const projectsRoot = home => join(resolve(home), 'storages', 'meiji', 'projects')
export const indexFile = (home, id) => join(projectsRoot(home), id + '.json')
export const episodesDir = (home, id) => join(projectsRoot(home), id, 'episodes')

export function oldLayoutError(id) {
  return Object.assign(new Error(`项目 ${id} 仍是旧的单文件存储，请停止服务后执行：node meiji/scripts/migrate-layout.js <DSH_HOME>`), { code: 'OLD_LAYOUT', status: 409 })
}

// 项目目录下的项目 id（只看文件名，不解析内容）。
export async function projectIds(home) {
  let files
  try { files = await readdir(projectsRoot(home)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  return files.filter(file => file.endsWith('.json') && uuid.test(file.slice(0, -5))).map(file => file.slice(0, -5))
}

// 读取并组装完整项目（episodes 为完整剧集对象）。文件不存在时抛 ENOENT。
export async function readProjectFile(home, id) {
  for (let attempt = 0; ; attempt++) {
    const index = JSON.parse(await readFile(indexFile(home, id), 'utf8'))
    if (index?.id !== id) throw new Error('项目文件损坏')
    if (index.layout !== LAYOUT) throw oldLayoutError(id)
    try {
      const episodes = []
      for (const ref of index.episodes || []) episodes.push(JSON.parse(await readFile(join(episodesDir(home, id), ref.file), 'utf8')))
      const { layout, ...project } = index
      return { ...project, episodes }
    } catch (error) {
      // 并发保存已提交新索引并清理了旧剧集文件：重读索引。
      if (error.code === 'ENOENT' && attempt < 5) continue
      throw error
    }
  }
}

// 保存前每集内容的快照（必须在执行补丁之前取：补丁函数可能直接修改读到的对象）。
export function episodeSnapshot(project) {
  return new Map((project?.episodes || []).map(episode => [episode.id, JSON.stringify(episode)]))
}

// 写入完整项目。before 为 episodeSnapshot(保存前的项目)，用于只重写有变化的剧集；新建项目传 null。
export async function writeProjectFile(home, project, before = null) {
  const dir = episodesDir(home, project.id)
  await mkdir(dir, { recursive: true })
  let oldRefs = new Map()
  try {
    const stored = JSON.parse(await readFile(indexFile(home, project.id), 'utf8'))
    if (stored.layout === LAYOUT) oldRefs = new Map((stored.episodes || []).map(ref => [ref.id, ref]))
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const refs = []
  for (const episode of project.episodes || []) {
    if (!safeId.test(String(episode.id || ''))) throw new Error('剧集 ID 无效')
    const text = JSON.stringify(episode, null, 2) + '\n'
    const old = oldRefs.get(episode.id)
    if (old && before?.get(episode.id) === JSON.stringify(episode)) { refs.push(old); continue }
    const file = `${episode.id}.${randomUUID().slice(0, 8)}.json`
    await writeFile(join(dir, file), text, { mode: 0o600, flag: 'wx' })
    refs.push({ id: episode.id, file })
  }
  const target = indexFile(home, project.id)
  const temporary = target + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify({ ...project, episodes: refs, layout: LAYOUT }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }) }
  // 提交后清理：删除不再被索引引用的剧集文件（含此前中断保存留下的孤立文件）。
  const keep = new Set(refs.map(ref => ref.file))
  for (const file of await readdir(dir).catch(() => [])) {
    if (file.endsWith('.json') && !keep.has(file)) await rm(join(dir, file), { force: true }).catch(() => {})
  }
}

export async function removeProjectFiles(home, id) {
  await rm(episodesDir(home, id), { recursive: true, force: true })
  await rm(indexFile(home, id))
}
