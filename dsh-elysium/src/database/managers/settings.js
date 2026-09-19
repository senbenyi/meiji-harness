// 职责：校验并原子读写唯一运行设置文件，为各设置分区提供同一把文件锁。
import { chmodSync, existsSync, mkdir, mkdirSync, open, readFileSync, rename, renameSync, rm, statSync, writeFile, writeFileSync } from '../files.js'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateRegistry } from '../../worker/models/catalog/registry-schema.js'
import { validateSelection } from '../../worker/models/catalog/selection-schema.js'
import { statusError } from '../../utils/errors.js'

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, allowed, message) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(message)
}
const clone = value => structuredClone(value)
const modelKinds = ['image', 'video']
const qualities = ['fast', 'regular', 'high']

function validateCreation(creation) {
  exactKeys(creation, ['revision', 'quality'], 'Elysium settings.json 创作质量无效')
  if (!Number.isSafeInteger(creation.revision) || creation.revision < 0 || !qualities.includes(creation.quality)) throw new Error('Elysium settings.json 创作质量无效')
}

function validateModels(models) {
  exactKeys(models, modelKinds, 'Elysium settings.json 模型清单无效')
  if (Object.keys(models).length !== modelKinds.length) throw new Error('Elysium settings.json 模型清单无效')
  for (const kind of modelKinds) {
    const ids = new Set()
    if (!Array.isArray(models[kind])) throw new Error('Elysium settings.json 模型清单无效')
    for (const model of models[kind]) {
      exactKeys(model, ['id', 'label', 'server_id'], 'Elysium settings.json 模型配置项无效')
      if (!/^[A-Za-z0-9_-]+$/.test(model.id || '') || ids.has(model.id) || typeof model.label !== 'string' || !model.label.trim()
        || model.server_id !== undefined && !/^[A-Za-z0-9_-]+$/.test(model.server_id)) throw new Error('Elysium settings.json 模型配置项无效')
      ids.add(model.id)
    }
  }
}

function validateChat(chat) {
  exactKeys(chat, ['id', 'label', 'backend', 'tunnel'], 'Elysium settings.json 聊天模型无效')
  if (!/^[A-Za-z0-9._-]+$/.test(chat.id || '') || typeof chat.label !== 'string' || !chat.label.trim()) throw new Error('Elysium settings.json 聊天模型无效')
  exactKeys(chat.backend, ['server_id', 'provider', 'service', 'base_url', 'connection'], 'Elysium settings.json 聊天后端无效')
  exactKeys(chat.backend.connection, ['model', 'api_key_env'], 'Elysium settings.json 聊天后端无效')
  if (!/^[A-Za-z0-9_-]+$/.test(chat.backend.server_id || '') || !/^[a-z][a-z0-9_-]*$/.test(chat.backend.provider || '') || chat.backend.service !== 'llm'
    || typeof chat.backend.base_url !== 'string' || chat.backend.connection.model !== chat.id
    || chat.backend.connection.api_key_env !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(chat.backend.connection.api_key_env)) throw new Error('Elysium settings.json 聊天后端无效')
  let url
  try { url = new URL(chat.backend.base_url) } catch { throw new Error('Elysium settings.json 聊天后端无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Elysium settings.json 聊天后端无效')
  exactKeys(chat.tunnel, ['alias', 'transport', 'ssh_alias', 'remote_host', 'remote_port', 'local_port', 'api_path'], 'Elysium settings.json 聊天隧道无效')
  if (!/^[A-Za-z0-9_-]+$/.test(chat.tunnel.alias || '') || chat.tunnel.transport !== 'ssh' || !/^[A-Za-z0-9_-]+$/.test(chat.tunnel.ssh_alias || '')
    || !/^[A-Za-z0-9.:-]+$/.test(chat.tunnel.remote_host || '') || ![chat.tunnel.remote_port, chat.tunnel.local_port].every(port => Number.isInteger(port) && port > 0 && port <= 65535)
    || !/^\/[A-Za-z0-9/_-]*$/.test(chat.tunnel.api_path || '')) throw new Error('Elysium settings.json 聊天隧道无效')
}

export function validateSettings(value) {
  exactKeys(value, ['version', 'enableAtomicTools', 'creation', 'models', 'chat', 'connections', 'selection', 'providers'], 'Elysium settings.json 配置无效')
  if (value.version !== 1 || Object.hasOwn(value, 'enableAtomicTools') && typeof value.enableAtomicTools !== 'boolean') throw new Error('Elysium settings.json 配置无效')
  const normalized = { ...value }
  delete normalized.enableAtomicTools
  validateCreation(normalized.creation)
  validateModels(normalized.models)
  validateChat(normalized.chat)
  validateRegistry(normalized.connections)
  validateSelection(normalized.selection)
  if (!object(normalized.providers) || Object.entries(normalized.providers).some(([id, config]) => !/^[a-z][a-z0-9_-]*$/.test(id) || !object(config))) throw new Error('Elysium settings.json 平台配置无效')
  return normalized
}

export function readSettings(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (!text.trim()) return null
  try {
    const value = JSON.parse(text)
    if (value.version === 1 && value.creation === undefined) value.creation = { revision: 0, quality: 'regular' }
    return clone(validateSettings(value))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Elysium settings.json 无效')
    throw error
  }
}

const readJson = path => {
  if (!path || !existsSync(path) || statSync(path).size === 0) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function ensureSettings({ path, defaults, registryFile, selectionFile, providerFiles = {} }) {
  const current = readSettings(path)
  if (current) {
    if ((statSync(path).mode & 0o777) !== 0o600) chmodSync(path, 0o600)
    return current
  }
  const settings = clone(defaults)
  const registry = readJson(registryFile)
  if (registry) {
    const { active, third_party, ...connections } = registry
    settings.connections = validateRegistry(connections)
    if (!readJson(selectionFile)) {
      settings.selection.selected = Object.fromEntries([['image', active?.image], ['video', active?.video || active?.comfyui]].filter(([, value]) => value))
      settings.selection.third_party = third_party || {}
    }
  }
  const selection = readJson(selectionFile)
  if (selection) settings.selection = validateSelection(selection)
  for (const [id, file] of Object.entries(providerFiles)) {
    const config = readJson(file)
    if (config) settings.providers[id] = config
  }
  validateSettings(settings)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
  return clone(settings)
}

export async function updateSettings(path, change) {
  await mkdir(dirname(path), { recursive: true })
  let lock
  try { lock = await open(`${path}.lock`, 'wx', 0o600) }
  catch (error) {
    if (error.code === 'EEXIST') throw statusError(409, 'Elysium 设置正在修改，请刷新重试；异常退出遗留锁需人工核对')
    throw error
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const current = readSettings(path)
    if (!current) throw new Error('Elysium settings.json 尚未初始化')
    const next = validateSettings(await change(clone(current)))
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 })
    await rename(temporary, path)
    return clone(next)
  } finally {
    await rm(temporary, { force: true })
    await lock.close()
    await rm(`${path}.lock`, { force: true })
  }
}
