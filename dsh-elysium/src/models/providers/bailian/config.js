// 职责：读取独立百炼配置；任务快照只保留公开的视频参数。
import { readFileSync } from 'node:fs'
import { runtimeConfig } from '../../../config.js'
import { readSettings } from '../../../database/managers/settings.js'
const invalidConfig = message => Object.assign(new Error(message), { code: 'PROVIDER_CONFIG_INVALID' })

export function readBailian({ includeDisabled = false } = {}) {
  let value
  const settings = runtimeConfig().ELYSIUM_SETTINGS_FILE
  if (settings) value = readSettings(settings)?.providers.bailian
  else {
    const path = runtimeConfig().ELYSIUM_BAILIAN_FILE
    if (!path) return null
    try { value = JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return null; throw invalidConfig('百炼配置文件无效') }
  }
  if (!value) return null
  if (!value || typeof value.enabled !== 'boolean') throw invalidConfig('百炼 enabled 配置无效')
  if (!value.enabled && !includeDisabled) return null
  let url
  try { url = new URL(value.base_url) } catch { throw invalidConfig('百炼 API 地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalidConfig('百炼 API 地址无效')
  if (typeof value.api_key !== 'string' || !value.api_key.trim() || !value.video || typeof value.video !== 'object') throw invalidConfig('百炼 api_key 或 video 配置无效')
  return value
}
export function bailianBackend(kind) {
  if (kind !== 'video') return null
  const config = readBailian()
  if (!config) return null
  const { text_model, image_model, duration, resolution, ratio, prompt_extend, watermark } = config.video
  return { server_id: 'bailian', provider: 'bailian', provider_api_version: 1, service: 'video',
    base_url: config.base_url.replace(/\/+$/, ''), connection: { text_model, image_model, duration, resolution, ratio, prompt_extend, watermark } }
}
export function bailianKey(backend) {
  // 关闭开关只停止新任务选择，已提交任务仍可查询原供应商。
  const config = readBailian({ includeDisabled: true })
  if (!config?.api_key.trim()) throw new Error('请在百炼独立配置文件中填写 api_key')
  if (config.base_url.replace(/\/+$/, '') !== backend.base_url) throw new Error('原百炼任务 API 地址与当前凭据配置不一致')
  return config.api_key
}
