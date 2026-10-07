import { finish, targetNode, pictureOf } from '../../shared/drama-model.js'
import { pictureRecord } from '../../shared/image-assets.js'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { assetStore, MAX_ASSET_BYTES } from './asset-library-store.js'

export function pictureReference(asset) {
  return { prompt: asset.prompt || asset.origin?.prompt || '', assetId: asset.id, assetCategory: asset.category,
    localPath: `/plugins/meiji/asset-file?category=${asset.category}&id=${asset.id}` }
}

export async function savePicture(home, bytes, mime, category, name, origin = {}) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime]
  if (!extension) throw new Error('不支持的图片格式')
  const asset = await assetStore(home).import(category, `${name}.${extension}`, Readable.from([bytes]), MAX_ASSET_BYTES, origin)
  return pictureReference(asset)
}

export async function readPicture(home, project, item) {
  if (pictureOf(item).assetId) {
    const file = await assetStore(home).file(pictureOf(item).assetCategory, pictureOf(item).assetId)
    return { bytes: await readFile(file.path), mime: file.metadata.mime }
  }
  const url = new URL(pictureOf(item).localPath || '', 'http://localhost')
  const episodeId = url.searchParams.get('episodeId') || ''
  if (episodeId && episodeId !== project.episodeId) throw new Error('图片与当前剧集不匹配')
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(item.id)) throw new Error('图片 ID 无效')
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'images', episodeId)
  for (const [ext, mime] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']]) {
    try { return { bytes: await readFile(join(directory, `${item.id}.${ext}`)), mime } }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  throw Object.assign(new Error('图片不存在'), { code: 'ENOENT' })
}

// 读取一张分镜参考图（素材库图片、旧版剧集图片或上一镜尾帧）的字节。
export async function readReferenceImage(home, project, image) {
  if (image?.kind === 'tailFrame') {
    const file = String(image.sourceVideoFile || '')
    if (!/^[A-Za-z0-9_-]+\.mp4$/.test(file)) throw new Error('尾帧对应的视频文件无效')
    const path = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '', file.replace(/\.mp4$/, '-last.png'))
    return { bytes: await readFile(path), mime: 'image/png' }
  }
  if (image?.assetId) return readPicture(home, project, { assetId: image.assetId, assetCategory: image.assetCategory })
  return readPicture(home, project, { id: image?.id, localPath: image?.localPath || image?.url })
}

// 视频请求中的参考图：按快照顺序读取本地图片，转成 base64 data URL（对应 <Picture N>）。
export async function referenceImageData(home, project, images) {
  const list = []
  for (const image of images) {
    let picture
    try { picture = await readReferenceImage(home, project, image) }
    catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error(`参考图不存在：${image.label || image.name || image.id || image.url}`), { status: 409 })
      throw error
    }
    list.push(`data:${picture.mime};base64,${picture.bytes.toString('base64')}`)
  }
  return list
}

export async function saveImageDraft(home, bytes, mime, category, name, origin) {
  const draftId = randomUUID()
  const directory = join(home, 'storages', 'meiji', 'image-drafts', draftId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'image'), bytes, { mode: 0o600 })
  await writeFile(join(directory, 'metadata.json'), JSON.stringify({ mime, category, name, ...origin }), { mode: 0o600 })
  return { draftId, prompt: origin?.prompt || '', previewUrl: `/plugins/meiji/image-draft?id=${draftId}` }
}

export async function readImageDraft(home, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw Object.assign(new Error('预览 ID 无效'), { status: 400 })
  const directory = join(home, 'storages', 'meiji', 'image-drafts', id)
  return { directory, bytes: await readFile(join(directory, 'image')), metadata: JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) }
}

export function pictureTargetSnapshot(item) {
  return JSON.stringify(item, (key, value) => ['check', 'review', 'draft', 'revision', 'status', 'operation', 'error'].includes(key) ? undefined : value)
}

// 人工确认和人物自动保存共用同一入库事务；调用方负责确认策略与执行权限。
export async function applyImageDraft(home, projects, project, draft, signal) {
  const targetKey = `image:${draft.itemId}`
  const validate = current => {
    const item = current.plot[draft.key]?.items.find(item => item.id === draft.itemId)
    if (!item || pictureTargetSnapshot(item) !== draft.target) throw Object.assign(new Error('图片对应内容已修改，请重新生成'), { status: 409 })
    return item
  }
  validate(project)
  const file = await readImageDraft(home, draft.draftId)
  if (file.metadata.projectId !== project.id || file.metadata.episodeId !== project.episodeId || file.metadata.itemId && file.metadata.itemId !== draft.itemId) throw Object.assign(new Error('图片不属于当前剧集或人物'), { status: 409 })
  signal?.throwIfAborted()
  const reference = await savePicture(home, file.bytes, file.metadata.mime, file.metadata.category, file.metadata.name, file.metadata)
  reference.prompt = file.metadata.prompt || ''
  const discarded = new Set([draft.draftId])
  try {
    signal?.throwIfAborted()
    await projects.save(project.id, current => {
      signal?.throwIfAborted()
      validate(current)
      const next = structuredClone(current)
      next.plot[draft.key].items = next.plot[draft.key].items.map(item => item.id === draft.itemId ? pictureRecord({ ...item, ...reference }) : item)
      for (const [id, pending] of Object.entries(next.pendingImages || {})) if (pending.itemId === draft.itemId && !pending.slot) { discarded.add(id); delete next.pendingImages[id] }
      finish(targetNode(next, targetKey), { passed: true, failures: [] })
      return next
    }, { final: true })
  } catch (error) {
    await rm(join(home, 'storages', 'meiji', 'assets', reference.assetCategory, reference.assetId), { recursive: true, force: true })
    throw error
  }
  for (const id of discarded) await rm(join(home, 'storages', 'meiji', 'image-drafts', id), { recursive: true, force: true })
  return reference
}
