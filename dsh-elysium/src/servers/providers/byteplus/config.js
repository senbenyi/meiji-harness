// 职责：读取独立三方模型配置，后端快照只保存公开参数。
import { readFileSync } from 'node:fs'
import { runtimeConfig, requiredConfig } from '../../../config.js'

export function readBytePlus() {
  const path = runtimeConfig().ELYSIUM_BYTEPLUS_FILE
  if (!path) return null
  let value
  try { value = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('三方模型配置文件无效') }
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') throw new Error('三方模型 enabled 配置无效')
  if (!value.enabled) return null
  const url = new URL(value.base_url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('三方模型 API 地址无效')
  for (const kind of ['image', 'video']) if (!value[kind] || typeof value[kind].model !== 'string') throw new Error(`三方${kind}模型配置无效`)
  if (typeof value.api_key !== 'string') throw new Error('三方模型 api_key 配置无效')
  return value
}
export function bytePlusBackend(kind) {
  const config = readBytePlus()
  if (!config) return null
  return { server_id: 'byteplus', provider: 'byteplus', provider_api_version: 1, service: kind,
    base_url: config.base_url.replace(/\/+$/, ''), connection: { ...config[kind] } }
}
export function bytePlusKey(backend) {
  requiredConfig('ELYSIUM_BYTEPLUS_FILE')
  const config = readBytePlus()
  if (!config?.api_key.trim()) throw new Error('请在三方模型独立配置文件中填写 api_key')
  if (config.base_url.replace(/\/+$/, '') !== backend.base_url) throw new Error('原任务 API 地址与当前凭据配置不一致')
  return config.api_key
}
