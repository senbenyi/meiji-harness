// 职责：读取独立 BytePlus 配置；任务快照只保存公开的视频参数。
import { readFileSync } from 'node:fs'
import { runtimeConfig } from '../../../utils/config.js'
import { readSettings } from '../../settings/store.js'
const invalidConfig = message => Object.assign(new Error(message), { code: 'PROVIDER_CONFIG_INVALID' })

export function readBytePlus({ includeDisabled = false } = {}) {
  let value
  const settings = runtimeConfig().ELYSIUM_SETTINGS_FILE
  if (settings) value = readSettings(settings)?.providers.byteplus
  else {
    const path = runtimeConfig().ELYSIUM_BYTEPLUS_FILE
    if (!path) return null
    try { value = JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return null; throw invalidConfig('BytePlus 配置文件无效') }
  }
  if (!value) return null
  if (!value || typeof value.enabled !== 'boolean') throw invalidConfig('BytePlus enabled 配置无效')
  if (!value.enabled && !includeDisabled) return null
  let url
  try { url = new URL(value.base_url) } catch { throw invalidConfig('BytePlus API 地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalidConfig('BytePlus API 地址无效')
  if (typeof value.api_key !== 'string' || !value.api_key.trim() || !value.video || typeof value.video !== 'object' || typeof value.video.model !== 'string' || !value.video.model.trim()) throw invalidConfig('BytePlus api_key 或 video 配置无效')
  return value
}
export function bytePlusBackend(kind) {
  const config = readBytePlus()
  if (!config || kind !== 'video') return null
  const { model, duration, resolution, ratio, generate_audio, watermark } = config.video
  return { server_id: 'byteplus', provider: 'byteplus', provider_api_version: 1, service: kind,
    base_url: config.base_url.replace(/\/+$/, ''), connection: { model, duration, resolution, ratio, generate_audio, watermark } }
}
export function bytePlusKey(backend) {
  const config = readBytePlus({ includeDisabled: true })
  if (!config?.api_key.trim()) throw new Error('请在 BytePlus 独立配置文件中填写 api_key')
  if (config.base_url.replace(/\/+$/, '') !== backend.base_url) throw new Error('原任务 API 地址与当前凭据配置不一致')
  return config.api_key
}
