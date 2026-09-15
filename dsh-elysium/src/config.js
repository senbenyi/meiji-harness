// 职责：解析插件实例配置，并为异步执行链隔离运行时配置。
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { readRegistry } from './servers/registry/store.js'
import { AsyncLocalStorage } from 'node:async_hooks'

// 读取并校验必需配置；URL 统一去掉尾部斜杠。
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

// 每个插件实例的配置沿异步调用链传递，避免并发实例互相污染。
const context = new AsyncLocalStorage()
const fields = {
  comfyUrl: ['COMFYUI_URL', 'url'],
  stateRoot: ['ELYSIUM_STATE_ROOT', 'path'],
  serversFile: ['ELYSIUM_SERVERS_FILE', 'path'],
  byteplusFile: ['ELYSIUM_BYTEPLUS_FILE', 'path'],
}
// 模型清单由系统配置提供，图片工作流尚未配置时保持空列表。
export const defaultModels = {
  llm: [{ id: 'qwen38', label: 'Qwen3.8 27B' }],
  analysis: [{ id: 'qwen38', label: 'Qwen3.8 27B' }],
  image: [],
  video: [{ id: 'minimax-h3', label: 'MiniMax H3' }],
}

// 优先读取当前调用链的实例配置；未绑定时使用进程环境。
export const runtimeConfig = () => context.getStore() || process.env
// 为回调及其派生的异步操作绑定配置，不修改 process.env。
export const withConfig = (config, callback) => context.run(config, callback)

// 将插件配置转换为经过校验的、不可变的运行时配置。
export function resolveConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('插件 config 必须为对象')
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(fields, key) && !['enableAtomicTools', 'models'].includes(key)) throw new Error(`未知插件配置：${key}`)
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const defaults = { stateRoot: join(home, 'storages', 'elysium'), serversFile: join(home, 'servers.json'), byteplusFile: join(home, 'byteplus.json') }
  const registryFile = config.serversFile ?? process.env.ELYSIUM_SERVERS_FILE ?? defaults.serversFile
  withConfig({ ELYSIUM_SERVERS_FILE: registryFile }, () => requiredConfig('ELYSIUM_SERVERS_FILE'))
  const registry = readRegistry(registryFile)
  const resolved = {}
  const configuredModels = config.models ?? defaultModels
  if (!configuredModels || typeof configuredModels !== 'object' || Array.isArray(configuredModels)) throw new Error('模型清单无效')
  const models = { analysis: defaultModels.analysis, ...configuredModels }
  if (Object.keys(models).some(key => !['llm', 'analysis', 'image', 'video'].includes(key))) throw new Error('模型清单无效')
  for (const kind of ['llm', 'analysis', 'image', 'video']) {
    const ids = new Set()
    if (!Array.isArray(models[kind])) throw new Error('模型清单必须包含文本、分析、图片和视频列表')
    for (const model of models[kind]) {
      if (!model || Object.keys(model).some(key => !['id', 'label', 'server_id'].includes(key)) || !/^[A-Za-z0-9_-]+$/.test(model.id || '') || ids.has(model.id) || typeof model.label !== 'string' || !model.label.trim() || (model.server_id !== undefined && !/^[A-Za-z0-9_-]+$/.test(model.server_id))) throw new Error('模型配置项无效')
      ids.add(model.id)
    }
  }
  resolved.ELYSIUM_MODELS = structuredClone(models)
  for (const [key, [name, kind]] of Object.entries(fields)) {
    // 有服务器清单时，由清单解析目标地址，忽略旧的单地址配置。
    if (key === 'comfyUrl' && registry) continue
    // 显式配置优先，其次为环境变量、默认值；显式无效值不自动回退。
    const value = Object.hasOwn(config, key) ? config[key] : process.env[name] ?? defaults[key]
    if (value === undefined) continue
    resolved[name] = value
    resolved[name] = withConfig(resolved, () => requiredConfig(name, kind))
  }
  if (config.enableAtomicTools !== undefined && typeof config.enableAtomicTools !== 'boolean') throw new Error('enableAtomicTools 必须为布尔值')
  resolved.ELYSIUM_ENABLE_ATOMIC_TOOLS = (config.enableAtomicTools ?? (process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1')) ? '1' : '0'
  return Object.freeze(resolved)
}

// 构造子进程环境，并清除当前实例未配置的插件字段，避免继承宿主旧值。
export function workerEnvironment() {
  const config = runtimeConfig()
  const env = { ...process.env }
  for (const name of [...Object.values(fields).map(([name]) => name), 'ELYSIUM_ENABLE_ATOMIC_TOOLS']) {
    delete env[name]
    if (config[name] !== undefined) env[name] = config[name]
  }
  return env
}
