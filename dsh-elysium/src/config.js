// 职责：集中加载仓库配置、解析插件实例配置，并为异步执行链隔离运行时配置。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureSettings, providerConfigFields, providerConfigDefaults, providerConfigSources, readSettings as readRuntimeSettings, validateSettings } from './worker/models/managers/runtime/index.js'
import { defaultElysiumHome } from './database/paths.js'
import { runtimeConfig, withConfig } from './utils/context.js'
import { requiredConfig } from './utils/validation.js'

export { runtimeConfig, withConfig, requiredConfig, defaultElysiumHome }
const fields = {
  home: ['ELYSIUM_HOME', 'path'],
  comfyUrl: ['COMFYUI_URL', 'url'],
  stateRoot: ['ELYSIUM_STATE_ROOT', 'path'],
  settingsFile: ['ELYSIUM_SETTINGS_FILE', 'path'],
  serversFile: ['ELYSIUM_SERVERS_FILE', 'path'],
  selectionFile: ['ELYSIUM_CONFIG_FILE', 'path'],
  ...providerConfigFields(),
}
const defaultsFile = new URL('../config/defaults.json', import.meta.url)
const toolsFile = new URL('../config/tools.json', import.meta.url)
const workcardFile = new URL('../config/workcard.json', import.meta.url)
const modelKinds = ['image', 'video']

export function readDefaults(path = defaultsFile) {
  let value
  try { value = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('Elysium defaults.json 无效') }
  return structuredClone(validateSettings(value))
}

// 仓库托管的非敏感业务默认值；运行状态和凭据不从此文件读取。
export const defaultSettings = JSON.parse(readFileSync(defaultsFile, 'utf8'))
export const defaultModels = defaultSettings.models
export const toolsConfig = JSON.parse(readFileSync(toolsFile, 'utf8'))
export const workcardConfig = JSON.parse(readFileSync(workcardFile, 'utf8'))
export const runtimeSettings = () => readRuntimeSettings(requiredConfig('ELYSIUM_SETTINGS_FILE'))
export const creationQuality = () => runtimeConfig().ELYSIUM_SETTINGS_FILE ? runtimeSettings().creation.quality : defaultSettings.creation.quality

// 限定插件入口可接受的配置字段。
function validatePluginConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('插件 config 必须为对象')
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(fields, key) && key !== 'models') throw new Error(`未知插件配置：${key}`)
  }
}

// 校验数据根目录以及用户显式传入或环境继承的配置文件路径。
function validateConfigPaths(config, home) {
  withConfig({ ELYSIUM_HOME: home }, () => requiredConfig('ELYSIUM_HOME'))
  for (const key of ['serversFile', 'selectionFile', ...Object.keys(providerConfigFields())]) {
    const [name, kind] = fields[key]
    const value = Object.hasOwn(config, key) ? config[key] : process.env[name]
    if (value !== undefined) withConfig({ [name]: value }, () => requiredConfig(name, kind))
  }
}

// 基于当前实例的 home 构造所有可回退的默认路径。
function configDefaults(home) {
  return { home, stateRoot: home, settingsFile: join(home, 'config', 'settings.json'), serversFile: join(home, 'config', 'servers.json'), selectionFile: join(home, 'config', 'selection.json'),
    ...providerConfigDefaults(join(home, 'config', 'providers')) }
}

// 定位统一 Settings 文件，完成初始化并返回其中的运行时设置。
function resolveSettings(config, defaults) {
  const configuredSettingsFile = config.settingsFile ?? process.env.ELYSIUM_SETTINGS_FILE ?? defaults.settingsFile
  withConfig({ ELYSIUM_SETTINGS_FILE: configuredSettingsFile }, () => requiredConfig('ELYSIUM_SETTINGS_FILE'))
  const providerFiles = Object.fromEntries(providerConfigSources().map(({ id, field, env }) => [id, config[field] ?? process.env[env] ?? defaults[field]]))
  const settings = ensureSettings({ path: configuredSettingsFile, defaults: defaultSettings,
    registryFile: config.serversFile ?? process.env.ELYSIUM_SERVERS_FILE ?? defaults.serversFile,
    selectionFile: config.selectionFile ?? process.env.ELYSIUM_CONFIG_FILE ?? defaults.selectionFile, providerFiles })
  return { configuredSettingsFile, settings }
}

// 校验图片和视频模型清单，并丢弃仅为旧版兼容保留的文本模型字段。
function resolveModels(config, settings) {
  const configuredModels = config.models ?? settings.models
  if (!configuredModels || typeof configuredModels !== 'object' || Array.isArray(configuredModels)) throw new Error('模型清单无效')
  if (Object.keys(configuredModels).some(key => ![...modelKinds, 'llm', 'analysis'].includes(key))
    || ['llm', 'analysis'].some(kind => configuredModels[kind] !== undefined && !Array.isArray(configuredModels[kind]))) throw new Error('模型清单无效')
  const models = Object.fromEntries(modelKinds.map(kind => [kind, structuredClone(configuredModels[kind])]))
  for (const kind of modelKinds) {
    const ids = new Set()
    if (!Array.isArray(models[kind])) throw new Error('模型清单必须包含图片和视频列表')
    for (const model of models[kind]) {
      if (!model || Object.keys(model).some(key => !['id', 'label', 'server_id'].includes(key)) || !/^[A-Za-z0-9_-]+$/.test(model.id || '') || ids.has(model.id) || typeof model.label !== 'string' || !model.label.trim() || (model.server_id !== undefined && !/^[A-Za-z0-9_-]+$/.test(model.server_id))) throw new Error('模型配置项无效')
      ids.add(model.id)
    }
  }
  return models
}

// 按“显式配置 -> 环境变量 -> 实例默认值”组装普通运行时字段。
function resolveRuntimeFields(config, defaults, configuredSettingsFile, registry) {
  const resolved = {}
  for (const [key, [name, kind]] of Object.entries(fields)) {
    if (['serversFile', 'selectionFile', ...Object.keys(providerConfigFields())].includes(key)) continue
    // 有服务器清单时，由清单解析目标地址，忽略旧的单地址配置。
    if (key === 'comfyUrl' && registry?.servers.length) continue
    // 显式配置优先，其次为环境变量、默认值；显式无效值不自动回退。
    const value = key === 'settingsFile' ? configuredSettingsFile : Object.hasOwn(config, key) ? config[key] : process.env[name] ?? defaults[key]
    if (value === undefined) continue
    resolved[name] = value
    resolved[name] = withConfig(resolved, () => requiredConfig(name, kind))
  }
  return resolved
}

// 将插件配置转换为经过校验的、不可变的运行时配置。
export function resolveConfig(config = {}) {
  validateSettings(defaultSettings)
  validatePluginConfig(config)
  const home = config.home ?? process.env.ELYSIUM_HOME ?? defaultElysiumHome()
  validateConfigPaths(config, home)
  const defaults = configDefaults(home)
  const { configuredSettingsFile, settings } = resolveSettings(config, defaults)
  const resolved = resolveRuntimeFields(config, defaults, configuredSettingsFile, settings.connections)
  resolved.ELYSIUM_MODELS = resolveModels(config, settings)
  return Object.freeze(resolved)
}

// 构造子进程环境，并清除当前实例未配置的插件字段，避免继承宿主旧值。
export function workerEnvironment() {
  const config = runtimeConfig()
  const env = { ...process.env }
  delete env.ELYSIUM_ENABLE_ATOMIC_TOOLS
  for (const name of Object.values(fields).map(([name]) => name)) {
    delete env[name]
    if (config[name] !== undefined) env[name] = config[name]
  }
  return env
}
