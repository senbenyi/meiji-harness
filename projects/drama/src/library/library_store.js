import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const categories = new Set(['characters', 'clothing', 'props', 'scripts'])
const assetId = /^asset_[a-f0-9-]{36}$/i

/** 素材属于drama，不依赖当前会话；脚本正文与列表元数据分开存放。 */
export function createLibraryStore(root) {
  const directory = join(root, 'library')
  const metadata = async id => {
    if (!assetId.test(id)) throw new TypeError('无效的素材ID')
    const value = JSON.parse(await readFile(join(directory, id, 'metadata.json'), 'utf8'))
    if (value.id !== id || !categories.has(value.category) || typeof value.originalName !== 'string' || typeof value.created_at !== 'string')
      throw new TypeError('素材资料无效')
    return { id: value.id, category: value.category, originalName: value.originalName, created_at: value.created_at }
  }
  return {
    async list() {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) }
      catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const rows = await Promise.all(entries.filter(entry => entry.isDirectory() && assetId.test(entry.name)).map(entry => metadata(entry.name)))
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    },
    async readScript(id) {
      const row = await metadata(id)
      if (row.category !== 'scripts') throw new TypeError('该素材不是剧本')
      return readFile(join(directory, id, 'content.txt'), 'utf8')
    },
    async remove(id) {
      let row
      try { row = await metadata(id) }
      catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new TypeError('素材不存在'), { code: 'ENOENT' })
        throw error
      }
      await rm(join(directory, row.id), { recursive: true })
      return { id: row.id }
    },
    async importScript({ originalName, body }) {
      if (typeof originalName !== 'string' || !/\.(txt|text|md)$/i.test(originalName) || originalName.length > 200 || /[\\/\x00-\x1f]/.test(originalName))
        throw new TypeError('请选择TXT或Markdown剧本文件')
      if (typeof body !== 'string' || !body.trim()) throw new TypeError('剧本内容不能为空')
      if (Buffer.byteLength(body) > 1024 * 1024) throw new TypeError('剧本不能超过1MB')
      const id = `asset_${randomUUID()}`, temp = join(directory, `.${id}.tmp`)
      const row = { id, category: 'scripts', originalName, created_at: new Date().toISOString() }
      await mkdir(temp, { recursive: true, mode: 0o700 })
      try {
        await writeFile(join(temp, 'content.txt'), body, { mode: 0o600, flag: 'wx' })
        await writeFile(join(temp, 'metadata.json'), JSON.stringify(row, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
        await rename(temp, join(directory, id))
      } finally { await rm(temp, { recursive: true, force: true }) }
      return row
    },
  }
}
