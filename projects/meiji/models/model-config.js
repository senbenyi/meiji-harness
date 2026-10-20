import { SettingsModel } from '../shared/models/settings_model.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// 网关地址校验属于配置规则：只允许 http/https，且不得携带凭据、查询串或锚点。
export function gatewayBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw Object.assign(new Error('网关地址无效'), { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('网关地址无效'), { status: 400 })
  }
  return url.href.replace(/\/$/, '')
}


// MEIJI_MODELS_LOCAL 可替换本地配置路径；npm test 用它指向测试密钥，保证测试不读取真实密钥。
const localConfig = process.env.MEIJI_MODELS_LOCAL
  ? pathToFileURL(resolve(process.env.MEIJI_MODELS_LOCAL))
  : new URL('../config/models.local.json', import.meta.url)

// config/models.json 入 git，不含密钥；config/models.local.json 不入 git，存放密钥等本地值并覆盖同名字段。
export async function defaults(local = localConfig) {
  const base = JSON.parse(await readFile(new URL('../config/models.json', import.meta.url), 'utf8'))
  let override = {}
  try { override = JSON.parse(await readFile(local, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  return { ...base, ...override }
}
export function normalizeModels(raw) {
  const textBaseUrl = gatewayBaseUrl(raw?.textBaseUrl)
  // 旧媒体连接字段保留读取兼容；当前全部模型走 meiji-server，无需供应商密钥。
  const baseUrl = raw?.baseUrl ? gatewayBaseUrl(raw.baseUrl) : textBaseUrl
  const apiKey = String(raw?.apiKey || '').replace(/^Bearer\s+/i, '').trim()
  return { ...raw, baseUrl, textBaseUrl, apiKey, ...new SettingsModel(raw).toJSON() }
}
// 聊天读取会话模型，制作文本读取文本选择；本地 HTTP 不使用网关凭据。
export function modelRoute(config, purpose) {
  const selected = new SettingsModel(config)
  const kind = purpose === 'chat' ? 'session' : purpose === 'story' ? 'text' : purpose
  const model = selected[kind].model
  const local = (['session', 'text'].includes(kind) && ['qwen3.5:27b', 'codex-gpt'].includes(model)) || (kind === 'image' && ['krea2 turbo V2.5', 'gpt-image'].includes(model)) || (kind === 'video' && model === 'MiniMax-H3')
  return {
    baseUrl: gatewayBaseUrl(local ? config.textBaseUrl : config.baseUrl),
    apiKey: local ? 'ollama' : config.apiKey,
    model,
  }
}
