// 职责：发现独立平台模块并校验版本化契约，不静态引用具体平台或自动回退。
import { access, readdir } from 'node:fs/promises'
import { providerDefinitions } from './definitions.js'
const root = new URL('../providers/', import.meta.url)
const methods = ['validatePlan', 'executeJob', 'validate', 'connect', 'check', 'createClient', 'buildGraph', 'llmSettings', 'workflowSource', 'manage']
const unavailable = (id, reason) => Object.assign(new Error(`平台适配器 ${id} 不可用：${reason}`), { code: 'PROVIDER_UNAVAILABLE', status: 409 })
export function validateProvider(adapter, id) {
  if (adapter?.apiVersion !== 1 || adapter.id !== id || typeof adapter.label !== 'string' || !adapter.services ||
    !Object.keys(adapter.services).length || Object.keys(adapter.services).some(kind => !['comfyui', 'llm', 'image', 'video'].includes(kind)) || methods.some(method => typeof adapter[method] !== 'function')) throw unavailable(id, '接口契约不完整或版本不兼容')
  return adapter
}
export async function loadProvider(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(id)) throw unavailable(String(id), '标识无效')
  const entry = new URL(`${id}/index.js`, root)
  try { await access(entry) } catch (error) { if (error.code === 'ENOENT') throw unavailable(id, '未安装或尚未实现'); throw error }
  let module
  try { module = await import(entry.href) } catch { throw unavailable(id, '模块或内部依赖加载失败') }
  return validateProvider(module.default, id)
}
export async function listProviders() {
  const rows = []
  const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9_-]{0,63}$/.test(entry.name)) continue
    try { const provider = await loadProvider(entry.name); rows.push({ id: provider.id, label: provider.label, available: true, services: provider.services }) }
    catch (error) { rows.push({ id: entry.name, label: entry.name, available: false, error: error.message, services: {} }) }
  }
  return rows
}

// 当前适配器源码进入任务指纹，缺失平台不会被静默略过。
export async function providerSourceFiles(id) {
  await loadProvider(id)
  const directory = new URL(`${id}/`, root)
  async function files(base) {
    const result = []
    for (const entry of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), base)
      if (entry.isDirectory() && ['tests', 'legacy', 'resources'].includes(entry.name)) continue
      if (entry.isDirectory()) result.push(...await files(url))
      else if (/\.(js|mjs|json)$/.test(entry.name)) result.push(url)
    }
    return result
  }
  const dependency = providerDefinitions().find(item => item.id === id)?.workflow_provider
  return [...await files(directory), ...(dependency ? await providerSourceFiles(dependency) : [])]
}
