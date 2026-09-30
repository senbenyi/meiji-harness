// 网关文件字段迁移：网关已不提供文件接口，删除图片远端地址 imageUrl 与上传记录 file（{ id, url }），改以本地图片为准。
// 用法（先停止 Harness）：node meiji/scripts/migrate-image-url.js <DSH_HOME>
//   人物/场景图片、附属图片、尾帧、分镜引用中的 imageUrl / file 删除；
//   分镜参考快照的远端地址改为本地地址（素材库或剧集图片地址；尾帧为 tail-frame:<视频文件>）；
//   只有远端地址、没有本地图片的人物/场景图片清空为未生成，并在结果中列出，需重新生成或导入；
//   素材库元数据中的 imageUrl 一并删除。视频任务记录中的历史请求参数不变。
// 没有旧字段的项目跳过，可重复执行。迁移前把项目索引与剧集文件备份到 <DSH_HOME>/backups/image-url-<时间>/<项目>/，
// 写入后读回核对：不再含旧字段、快照不含远端地址；不一致则还原该项目并中止。
import { cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { episodeSnapshot, episodesDir, indexFile, projectIds, readProjectFile, writeProjectFile, LAYOUT } from '../server/data/project-files.js'
import { categories } from '../server/data/library.js'
import { hasGatewayFileFields, node, pictureOf } from '../shared/drama-model.js'
import { tailFrameUrl } from '../shared/tail-frame.js'

const remote = url => /^https?:\/\//i.test(String(url || ''))

// 递归删除 imageUrl 与对象形式的 file（上传记录）；字符串形式的 file（视频文件名等）保留。
function strip(value) {
  if (Array.isArray(value)) { value.forEach(strip); return }
  if (!value || typeof value !== 'object') return
  delete value.imageUrl
  if (value.file && typeof value.file === 'object' && Object.hasOwn(value.file, 'url')) delete value.file
  Object.values(value).forEach(strip)
}

// 分镜快照条目对应的当前图片（人物、场景或人物附属图片）。
function snapshotSource(episode, ref) {
  const people = episode.plot?.characters?.items || []
  if (ref.ownerId) return people.find(item => item.id === ref.ownerId)?.[ref.slot]?.find(item => item.id === ref.id)
  const bag = ref.kind === 'scenes' ? episode.plot?.scenes?.items : people
  return (bag || []).find(item => item.id === ref.id)
}

// 迁移一集（原地修改）。返回清空的图片列表。
export function migrateEpisode(episode) {
  const cleared = []
  for (const key of ['characters', 'scenes']) {
    for (const item of episode.plot?.[key]?.items || []) {
      const media = item.image?.content
      if (media && (media.imageUrl || media.file) && !media.localPath && !media.assetId) {
        item.image = node(`image:${item.id}`)
        cleared.push(`${item.id} ${item.name || ''}`.trim())
      }
    }
  }
  for (const shot of episode.shots?.items || []) {
    const story = shot.storyboard?.content
    if (!Array.isArray(story?.referenceSnapshot)) continue
    story.referenceSnapshot = story.referenceSnapshot.map(ref => {
      if (ref.kind === 'tailFrame') return { ...ref, url: tailFrameUrl(ref.sourceVideoFile) }
      if (!remote(ref.url)) return ref
      return { ...ref, url: ref.localPath || pictureOf(snapshotSource(episode, ref)).localPath || '' }
    })
  }
  strip(episode)
  return cleared
}

function verify(project) {
  for (const episode of project.episodes) {
    if (hasGatewayFileFields(episode)) throw new Error(`${episode.id} 仍含 imageUrl 或文件记录`)
    for (const shot of episode.shots?.items || []) {
      if ((shot.storyboard?.content?.referenceSnapshot || []).some(ref => remote(ref.url))) throw new Error(`${episode.id} ${shot.id} 分镜快照仍含远端地址`)
    }
  }
}

async function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, file)
}

// 素材库元数据：删除 imageUrl（原文件先备份）。
async function migrateAssets(home, backup) {
  const root = join(home, 'storages', 'meiji', 'assets')
  let count = 0
  for (const category of categories) {
    let ids
    try { ids = await readdir(join(root, category)) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const id of ids) {
      const file = join(root, category, id, 'metadata.json')
      let metadata
      try { metadata = JSON.parse(await readFile(file, 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (!Object.hasOwn(metadata, 'imageUrl')) continue
      const target = join(backup(), 'assets', category, id)
      await mkdir(target, { recursive: true })
      await cp(file, join(target, 'metadata.json'))
      delete metadata.imageUrl
      await writeJson(file, metadata)
      count++
    }
  }
  return count
}

export async function migrateImageUrl(home) {
  let folder
  const backup = () => folder ??= join(home, 'backups', `image-url-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const projects = []
  for (const id of await projectIds(home)) {
    const index = JSON.parse(await readFile(indexFile(home, id), 'utf8'))
    if (index.layout !== LAYOUT) continue
    const project = await readProjectFile(home, id)
    if (!project.episodes.some(hasGatewayFileFields)) continue
    if (project.episodes.some(episode => episode.activity)) throw new Error(`${id} 仍有任务运行，先停止任务再迁移`)
    const target = join(backup(), project.id)
    await mkdir(target, { recursive: true })
    await cp(indexFile(home, project.id), join(target, project.id + '.json'))
    await cp(episodesDir(home, project.id), join(target, 'episodes'), { recursive: true })
    const next = structuredClone(project)
    const cleared = next.episodes.flatMap(episode => migrateEpisode(episode).map(name => `${episode.id}：${name}`))
    try {
      await writeProjectFile(home, next, episodeSnapshot(project))
      verify(await readProjectFile(home, project.id))
    } catch (error) {
      await cp(join(target, 'episodes'), episodesDir(home, project.id), { recursive: true, force: true })
      await cp(join(target, project.id + '.json'), indexFile(home, project.id), { force: true })
      throw new Error(`${project.id} 迁移失败，已还原该项目（备份：${target}）：${error.message}`)
    }
    projects.push({ id: project.id, cleared })
  }
  const assets = await migrateAssets(home, backup)
  if (!projects.length && !assets) return { migrated: 0 }
  return { migrated: projects.length, assets, backup: folder, projects }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-image-url.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateImageUrl(resolve(process.argv[2])), null, 2))
}
