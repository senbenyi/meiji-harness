// 职责：发现提供者的公开声明，供配置解析、安装与兼容迁移使用；不加载凭据。
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { cp, chmod } from 'node:fs/promises'
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
export function providerDefaultModels() {
  const result = { llm: [], analysis: [], image: [], video: [] }
  for (const item of providerDefinitions()) for (const [kind, models] of Object.entries(item.models || {})) result[kind].push(...models)
  return result
}
export function providerConfigNames() {
  return providerDefinitions().filter(item => item.config).flatMap(({ config }) => [config.file, config.file.replace(/\.json$/, '.example.json')])
}
export async function installProviderConfigs(home) {
  for (const { id, config } of providerDefinitions().filter(item => item.config)) {
    const target = join(home, config.file)
    if (!existsSync(target)) await cp(new URL(`${id}/config.example.json`, root), target, { force: false })
    await chmod(target, 0o600)
  }
}
export function providerEnvironment(home, projectDirectory) {
  return Object.fromEntries(providerDefinitions().filter(item => item.config).map(({ config }) => [config.env,
    process.env[config.env] ?? (existsSync(join(projectDirectory, config.file)) ? join(projectDirectory, config.file) : join(home, config.file))]))
}
