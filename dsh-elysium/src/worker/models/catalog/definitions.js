// 职责：发现提供者的公开声明，供配置解析、安装与兼容迁移使用；不加载凭据。
import { existsSync, readFileSync, readdirSync } from '../../../database/files.js'
import { join } from 'node:path'
const root = new URL('../providers/', import.meta.url)
export function providerDefinitions() {
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const file = new URL(`${entry.name}/definition.json`, root)
    return existsSync(file) ? [{ ...JSON.parse(readFileSync(file, 'utf8')), id: entry.name }] : []
  })
}
export function providerConfigFields() {
  return Object.fromEntries(providerDefinitions().filter(item => item.config).map(({ config }) => [config.field, [config.env, 'path']]))
}
export function providerConfigDefaults(home) {
  return Object.fromEntries(providerDefinitions().filter(item => item.config).map(({ config }) => [config.field, join(home, config.file)]))
}
export function providerConfigSources() {
  return providerDefinitions().filter(item => item.config).map(({ id, config }) => ({ id, field: config.field, env: config.env }))
}
