// 职责：解析插件实例配置，并为异步执行链隔离运行时配置。
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { AsyncLocalStorage } from 'node:async_hooks'

export function requiredConfig(name, kind = 'path') {
  const value = runtimeConfig()[name]
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`缺少或无效配置：${name}`)
  if (kind === 'path' && !isAbsolute(value)) throw new Error(`${name} 必须为绝对路径`)
  if (kind === 'url') {
    if (/\s/.test(value)) throw new Error(`${name} 地址不能包含空白字符`)
    let url
    try { url = new URL(value) } catch { throw new Error(`${name} 必须为 HTTP(S) 地址`) }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.port === '0' || url.username || url.password || url.search || url.hash) throw new Error(`${name} 必须为不含凭据、查询参数的 HTTP(S) 地址`)
    return value.replace(/\/+$/, '')
  }
  return value
}

// Cordis config belongs to a plugin instance, never to the host process globally.
const context = new AsyncLocalStorage()
const fields = {
  comfyUrl: ['COMFYUI_URL', 'url'],
  stateRoot: ['ELYSIUM_STATE_ROOT', 'path'],
}

export const runtimeConfig = () => context.getStore() || process.env
export const withConfig = (config, callback) => context.run(config, callback)

export function resolveConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('插件 config 必须为对象')
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(fields, key) && key !== 'enableAtomicTools') throw new Error(`未知插件配置：${key}`)
  }
  const home = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'elysium')
  const defaults = { stateRoot: join(home, 'tasks') }
  const resolved = {}
  for (const [key, [name, kind]] of Object.entries(fields)) {
    const value = Object.hasOwn(config, key) ? config[key] : process.env[name] ?? defaults[key]
    if (value === undefined) continue
    resolved[name] = value
    resolved[name] = withConfig(resolved, () => requiredConfig(name, kind))
  }
  if (config.enableAtomicTools !== undefined && typeof config.enableAtomicTools !== 'boolean') throw new Error('enableAtomicTools 必须为布尔值')
  resolved.ELYSIUM_ENABLE_ATOMIC_TOOLS = (config.enableAtomicTools ?? (process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1')) ? '1' : '0'
  return Object.freeze(resolved)
}

export function workerEnvironment() {
  const env = { ...process.env }
  for (const name of [...Object.values(fields).map(([name]) => name), 'ELYSIUM_ENABLE_ATOMIC_TOOLS']) {
    delete env[name]
    if (runtimeConfig()[name] !== undefined) env[name] = runtimeConfig()[name]
  }
  return env
}
