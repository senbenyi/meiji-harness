import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { guidanceTypes } from '../../shared/guidance.js'

export const categories = ['characters', 'scenes', 'props', 'audio', 'video', 'guidance']
export const MAX_GUIDANCE_BYTES = 128 * 1024
export function guidanceText(bytes) {
  let content
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim() }
  catch { throw Object.assign(new Error('指导素材须为 UTF-8 编码的 TXT/Markdown 文本'), { status: 400 }) }
  if (!content || content.includes('\0') || content.length > 20000) throw Object.assign(new Error('指导素材正文需为 1–20000 字'), { status: 400 })
  return content
}
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }
export const MAX_ASSET_BYTES = 512 * 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function assertCategory(category) {
  if (!categories.includes(category)) throw Object.assign(new Error('素材分类无效'), { status: 400 })
}
export function assetStore(home) {
  const root = join(home, 'storages', 'meiji', 'assets')
  return {
    async list(category) {
      assertCategory(category)
      let entries
      try { entries = await readdir(join(root, category)) }
      catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const assets = await Promise.all(entries.filter(id => uuid.test(id)).map(async id => JSON.parse(await readFile(join(root, category, id, 'metadata.json'), 'utf8'))))
      return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async file(category, id) {
      assertCategory(category)
      if (!uuid.test(id)) throw Object.assign(new Error('素材 ID 无效'), { status: 400 })
      const directory = join(root, category, id)
      const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'))
      return { metadata, path: join(directory, metadata.file) }
    },
    async import(category, name, source, maxBytes = MAX_ASSET_BYTES, origin = {}) {
      assertCategory(category)
      const originalName = typeof name === 'string' ? name.split(/[\\/]/).pop().trim() : ''
      const guidanceType = origin.guidanceType || 'other'
      if (category === 'guidance' && !guidanceTypes.some(([key]) => key === guidanceType)) throw Object.assign(new Error('指导素材分类无效'), { status: 400 })
      const extension = extname(originalName).toLowerCase(), mime = category === 'guidance' ? ({ '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.markdown': 'text/plain; charset=utf-8' })[extension] : types[extension]
      const family = category === 'guidance' ? 'text/' : category === 'audio' ? 'audio/' : category === 'video' ? 'video/' : 'image/'
      if (!originalName || originalName.length > 255 || !mime?.startsWith(family)) throw Object.assign(new Error('文件格式与所选素材分类不匹配'), { status: 400 })
      if (category === 'guidance') maxBytes = Math.min(maxBytes, MAX_GUIDANCE_BYTES)
      const id = randomUUID(), directory = join(root, category, id), staging = directory + '.upload'
      await mkdir(staging, { recursive: true })
      let size = 0
      try {
        const limiter = new Transform({ transform(chunk, _encoding, callback) {
          size += chunk.length
          callback(size > maxBytes ? Object.assign(new Error(category === 'guidance' ? '指导素材不能超过 128 KB' : '单个素材不能超过 512 MB'), { status: 413 }) : null, chunk)
        } })
        // Keep the incoming HTTP stream alive on a limit error so the handler can send an error response.
        const chunks = async function* () { for await (const chunk of source.iterator({ destroyOnReturn: false })) yield chunk }
        await pipeline(chunks(), limiter, createWriteStream(join(staging, 'original' + extension), { flags: 'wx', mode: 0o600 }))
        if (!size) throw Object.assign(new Error('不能导入空文件'), { status: 400 })
        const content = category === 'guidance' ? guidanceText(await readFile(join(staging, 'original' + extension))) : undefined
        const metadata = { version: 1, id, category, originalName, file: 'original' + extension, mime, size, ...(content === undefined ? {} : { content, guidanceType }), source: origin.source || 'import', ...(origin.imageUrl ? { imageUrl: origin.imageUrl } : {}), ...(origin.projectId ? { projectId: origin.projectId, episodeId: origin.episodeId || null, itemId: origin.itemId || null, prompt: origin.prompt || '' } : {}), createdAt: new Date().toISOString() }
        await writeFile(join(staging, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 })
        await rename(staging, directory)
        return metadata
      } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
    },
  }
}
