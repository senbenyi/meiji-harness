import { pictureOf } from '../../client/drama-model.js'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assetStore, MAX_ASSET_BYTES } from './library.js'

export function pictureReference(asset) {
  return { prompt: asset.prompt || asset.origin?.prompt || '', assetId: asset.id, assetCategory: asset.category,
    localPath: `/plugins/meiji/asset-file?category=${asset.category}&id=${asset.id}`, imageUrl: asset.imageUrl || null }
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
  const url = new URL(pictureOf(item).localPath || pictureOf(item).imageUrl || '', 'http://localhost')
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
  return JSON.stringify(item, (key, value) => ['check', 'review', 'draft', 'revision', 'status', 'operation', 'error', 'dependencies', 'stale'].includes(key) ? undefined : value)
}
