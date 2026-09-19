// 职责：读写 Elysium 新任务使用的模型选择，不保存服务器连接或平台凭据。
import { mkdir, open, readFileSync, rename, rm, writeFile } from '../files.js'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runtimeConfig } from '../../utils/context.js'
import { defaultElysiumHome } from '../paths.js'
import { readSettings, updateSettings } from './settings.js'
import { validateSelection } from '../../worker/models/catalog/selection-schema.js'

export { validateSelection } from '../../worker/models/catalog/selection-schema.js'
const unified = path => path === runtimeConfig().ELYSIUM_SETTINGS_FILE || basename(path) === 'settings.json'
export const selectionPath = () => runtimeConfig().ELYSIUM_SETTINGS_FILE || runtimeConfig().ELYSIUM_CONFIG_FILE
  || join(runtimeConfig().ELYSIUM_STATE_ROOT || runtimeConfig().ELYSIUM_HOME || process.env.ELYSIUM_HOME || defaultElysiumHome(), 'config', 'selection.json')

export function readSelection(path = selectionPath()) {
  if (unified(path)) return readSettings(path)?.selection || { version: 1, revision: 0, selected: {}, third_party: {} }
  try { return validateSelection(JSON.parse(readFileSync(path, 'utf8'))) }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, revision: 0, selected: {}, third_party: {} }
    throw error
  }
}

export async function writeSelection(next, expectedRevision, path = selectionPath()) {
  validateSelection(next)
  if (unified(path)) {
    let saved
    await updateSettings(path, settings => {
      if (settings.selection.revision !== expectedRevision) throw Object.assign(new Error('Elysium 选择配置版本冲突，请刷新后重试'), { status: 409 })
      saved = { ...next, revision: expectedRevision + 1 }
      return { ...settings, selection: saved }
    })
    return saved
  }
  await mkdir(dirname(path), { recursive: true })
  let lock
  try { lock = await open(`${path}.lock`, 'wx', 0o600) }
  catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(new Error('Elysium 选择配置正在修改，请刷新重试；异常退出遗留锁需人工核对'), { status: 409 })
    throw error
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const current = readSelection(path)
    if (current.revision !== expectedRevision) throw Object.assign(new Error('Elysium 选择配置版本冲突，请刷新后重试'), { status: 409 })
    const saved = { ...next, revision: expectedRevision + 1 }
    await writeFile(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 })
    await rename(temporary, path)
    return saved
  } finally {
    await rm(temporary, { force: true })
    await lock.close()
    await rm(`${path}.lock`, { force: true })
  }
}
