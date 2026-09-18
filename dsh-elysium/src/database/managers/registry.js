// 职责：读写本机服务器清单，以互斥文件和 revision 检查防止并发覆盖。
import { readFileSync } from 'node:fs'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runtimeConfig } from '../../utils/context.js'
import { defaultElysiumHome } from '../paths.js'
import { validateRegistry, serverIdentity, fail } from '../../models/managers/registry/schema.js'
import { readSettings, updateSettings } from './settings.js'
const unified = path => path === runtimeConfig().ELYSIUM_SETTINGS_FILE || basename(path) === 'settings.json'
export const registryPath = () => runtimeConfig().ELYSIUM_SETTINGS_FILE || runtimeConfig().ELYSIUM_SERVERS_FILE || join(runtimeConfig().ELYSIUM_HOME || process.env.ELYSIUM_HOME || defaultElysiumHome(), 'config', 'servers.json')
export function readRegistry(path = registryPath()) {
  if (unified(path)) return readSettings(path)?.connections || null
  try { return validateRegistry(JSON.parse(readFileSync(path, 'utf8'))) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
export async function writeRegistry(next, expectedRevision, path = registryPath()) {
  validateRegistry(next)
  if (unified(path)) {
    let saved
    await updateSettings(path, settings => {
      if (settings.connections.revision !== expectedRevision) throw Object.assign(new Error('服务器配置版本冲突，请刷新重试'), { status: 409 })
      for (const old of settings.connections.servers) {
        const updated = next.servers.find(server => server.id === old.id)
        if (!updated || serverIdentity(old) !== serverIdentity(updated)) fail('已登记连接身份不可删除或修改；请停用旧记录并登记新 ID')
      }
      const { active, third_party, ...connectionOnly } = next
      saved = { ...connectionOnly, revision: expectedRevision + 1 }
      return { ...settings, connections: saved }
    })
    return saved
  }
  await mkdir(dirname(path), { recursive: true })
  let lock
  try { lock = await open(`${path}.lock`, 'wx', 0o600) }
  catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('服务器清单正在修改，请刷新重试；异常退出遗留锁需人工核对'), { status: 409 }); throw error }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const current = readRegistry(path)
    if ((current?.revision || 0) !== expectedRevision) throw Object.assign(new Error('服务器配置版本冲突，请刷新后重试'), { status: 409 })
    for (const old of current?.servers || []) {
      const updated = next.servers.find(server => server.id === old.id)
      if (!updated || serverIdentity(old) !== serverIdentity(updated)) fail('已登记连接身份不可删除或修改；请停用旧记录并登记新 ID')
    }
    const { active, third_party, ...connectionOnly } = next
    const saved = { ...connectionOnly, revision: expectedRevision + 1 }
    await writeFile(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 })
    await rename(temporary, path)
    return saved
  } finally { await rm(temporary, { force: true }); await lock.close(); await rm(`${path}.lock`, { force: true }) }
}
