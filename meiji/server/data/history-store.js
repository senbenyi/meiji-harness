// 项目级领域事件、剧本版本与人工方案；制作快照归 Run/Step。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
const pending = new Map(), validId = /^[a-zA-Z0-9_-]+$/
const kinds = new Set(['events', 'script-revisions', 'script-proposals'])
export function historyStore(home, projectId) {
  if (!validId.test(projectId || '')) throw new Error('项目 ID 无效')
  const root = resolve(home, 'storages', 'meiji', 'projects', projectId, 'history')
  const path = (kind, id) => { if (!kinds.has(kind) || !validId.test(id || '')) throw new Error('记录范围无效'); return join(root, kind, `${id}.json`) }
  const read = async (kind, id) => JSON.parse(await readFile(path(kind, id), 'utf8'))
  const update = async (kind, id, change) => {
    const file = path(kind, id), work = (pending.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      let current = null
      try { current = await read(kind, id) } catch (error) { if (error.code !== 'ENOENT') throw error }
      const next = typeof change === 'function' ? await change(current) : change
      const temp = `${file}.${randomUUID()}.tmp`
      await mkdir(join(root, kind), { recursive: true })
      try { await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' }); await rename(temp, file) }
      finally { await rm(temp, { force: true }) }
      return next
    })
    pending.set(file, work)
    try { return await work } finally { if (pending.get(file) === work) pending.delete(file) }
  }
  return { read, update,
    async list(kind) { if (!kinds.has(kind)) throw new Error('记录范围无效'); let names; try { names = await readdir(join(root, kind)) } catch (error) { if (error.code === 'ENOENT') return []; throw error }; return Promise.all(names.filter(name => name.endsWith('.json')).map(name => read(kind, name.slice(0, -5)))) },
    async remove(kind, id) { await rm(path(kind, id), { force: true }) },
    async event(type, details = {}) { const id = randomUUID(); return update('events', id, { id, type, at: new Date().toISOString(), actor: 'human', ...details }) },
  }
}
