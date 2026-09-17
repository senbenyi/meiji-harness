// 职责：读写 Elysium 新任务使用的模型选择，不保存服务器连接或平台凭据。
import { readFileSync } from 'node:fs'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { runtimeConfig } from '../../config.js'

const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
const thirdPartyId = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}:[A-Za-z0-9_-]+$/.test(value)

export const selectionPath = () => runtimeConfig().ELYSIUM_CONFIG_FILE
  || join(runtimeConfig().ELYSIUM_STATE_ROOT || runtimeConfig().ELYSIUM_HOME || process.env.ELYSIUM_HOME || join(homedir(), '.elysium'), 'config.json')

export function validateSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['version', 'revision', 'selected', 'third_party'].includes(key))
    || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('Elysium 选择配置版本无效')
  for (const [field, check] of [['selected', id], ['third_party', thirdPartyId]]) {
    const entries = value[field]
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)
      || Object.keys(entries).some(key => !['image', 'video'].includes(key))
      || Object.values(entries).some(item => item !== null && !check(item))) fail('Elysium 模型选择无效')
  }
  return value
}

export function readSelection(path = selectionPath()) {
  try { return validateSelection(JSON.parse(readFileSync(path, 'utf8'))) }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, revision: 0, selected: {}, third_party: {} }
    throw error
  }
}

export async function writeSelection(next, expectedRevision, path = selectionPath()) {
  validateSelection(next)
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
