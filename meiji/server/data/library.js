import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const categories = ['characters', 'scenes', 'props', 'audio', 'video']
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
      const extension = extname(originalName).toLowerCase(), mime = types[extension]
      const family = category === 'audio' ? 'audio/' : category === 'video' ? 'video/' : 'image/'
      if (!originalName || originalName.length > 255 || !mime?.startsWith(family)) throw Object.assign(new Error('文件格式与所选素材分类不匹配'), { status: 400 })
      const id = randomUUID(), directory = join(root, category, id), staging = directory + '.upload'
      await mkdir(staging, { recursive: true })
      let size = 0
      try {
        const limiter = new Transform({ transform(chunk, _encoding, callback) {
          size += chunk.length
          callback(size > maxBytes ? Object.assign(new Error('单个素材不能超过 512 MB'), { status: 413 }) : null, chunk)
        } })
        // Keep the incoming HTTP stream alive on a limit error so the handler can send an error response.
        const chunks = async function* () { for await (const chunk of source.iterator({ destroyOnReturn: false })) yield chunk }
        await pipeline(chunks(), limiter, createWriteStream(join(staging, 'original' + extension), { flags: 'wx', mode: 0o600 }))
        if (!size) throw Object.assign(new Error('不能导入空文件'), { status: 400 })
        const metadata = { version: 1, id, category, originalName, file: 'original' + extension, mime, size, source: origin.source || 'import', ...(origin.imageUrl ? { imageUrl: origin.imageUrl } : {}), ...(origin.projectId ? { projectId: origin.projectId, episodeId: origin.episodeId || null, itemId: origin.itemId || null, prompt: origin.prompt || '' } : {}), createdAt: new Date().toISOString() }
        await writeFile(join(staging, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 })
        await rename(staging, directory)
        return metadata
      } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
    },
  }
}
