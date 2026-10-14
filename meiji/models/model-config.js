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

export const purposes = { chat: '聊天', story: '生成剧情', image: '文生图片', video: '生成视频' }
const purposeIds = Object.keys(purposes)

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
  const baseUrl = gatewayBaseUrl(raw?.baseUrl)
  const textBaseUrl = gatewayBaseUrl(raw?.textBaseUrl)
  const apiKey = String(raw?.apiKey || '').replace(/^Bearer\s+/i, '').trim()
  if (!apiKey) throw Object.assign(new Error('需要网关密钥'), { status: 400 })
  const names = {}
  for (const purpose of purposeIds) {
    const model = String(raw?.[purpose]?.model || '').trim()
    if (!model) throw Object.assign(new Error(`${purposes[purpose]}：请填写模型名`), { status: 400 })
    names[purpose] = model
  }
  if (names.image === names.chat || names.video === names.chat) {
    throw Object.assign(new Error('图片和视频不能使用文本模型'), { status: 400 })
  }
  const config = { ...raw, baseUrl, textBaseUrl, apiKey }
  return { baseUrl, textBaseUrl, apiKey, ...Object.fromEntries(purposeIds.map(purpose => [purpose, modelRoute(config, purpose)])) }
}
// 文本使用本机 Ollama，占位密钥不复用图片/视频网关的真实凭据。
export function modelRoute(config, purpose) {
  const text = purpose === 'chat' || purpose === 'story'
  return {
    baseUrl: gatewayBaseUrl(text ? config.textBaseUrl : config.baseUrl),
    apiKey: text ? 'ollama' : config.apiKey,
    model: String(config[purpose].model).trim(),
  }
}
export function compactModels(config) {
  return {
    baseUrl: config.baseUrl,
    textBaseUrl: config.textBaseUrl,
    apiKey: config.apiKey,
    chat: { model: config.chat.model },
    story: { model: config.story.model },
    image: { model: config.image.model },
    video: { model: config.video.model },
  }
}
