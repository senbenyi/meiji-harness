#!/usr/bin/env node

// 职责：将旧 DSH_HOME 中的 Elysium 数据复制到独立 ELYSIUM_HOME，不覆盖或删除现有数据。
import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, resolve } from 'node:path'

function safeHome(value, fallback, name) {
  const path = resolve(value || fallback)
  if (!isAbsolute(path) || path === parse(path).root || path === homedir()) throw new Error(`${name} 必须为独立的绝对目录`)
  return path
}
async function exists(path) {
  try { await access(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
async function copyMissing(source, target) {
  if (!await exists(source) || await exists(target)) return false
  await mkdir(resolve(target, '..'), { recursive: true })
  await cp(source, target, { recursive: true, errorOnExist: true, force: false })
  return true
}

const sourceHome = safeHome(process.env.DSH_HOME, join(homedir(), '.dsh'), 'DSH_HOME')
const targetHome = safeHome(process.env.ELYSIUM_HOME, join(homedir(), '.elysium'), 'ELYSIUM_HOME')
if (sourceHome === targetHome) throw new Error('DSH_HOME 与 ELYSIUM_HOME 不能相同')
await mkdir(targetHome, { recursive: true })

const legacyState = join(sourceHome, 'storages', 'elysium')
if (await exists(legacyState)) for (const entry of await readdir(legacyState)) {
  if (entry !== 'config.json' && await copyMissing(join(legacyState, entry), join(targetHome, entry))) console.log(`已复制 Elysium 数据：${entry}`)
}

const oldRegistryPath = join(sourceHome, 'servers.json'), registryPath = join(targetHome, 'servers.json'), configPath = join(targetHome, 'config.json')
if (await exists(oldRegistryPath)) {
  const oldRegistry = JSON.parse(await readFile(oldRegistryPath, 'utf8'))
  if (!await exists(registryPath)) {
    const { active, third_party, ...connections } = oldRegistry
    await writeFile(registryPath, JSON.stringify(connections, null, 2), { mode: 0o600, flag: 'wx' })
    console.log('已复制服务器连接清单：servers.json')
  }
  if (!await exists(configPath)) {
    const selected = {}
    if (oldRegistry.active?.image) selected.image = oldRegistry.active.image
    if (oldRegistry.active?.video || oldRegistry.active?.comfyui) selected.video = oldRegistry.active.video || oldRegistry.active.comfyui
    const selection = { version: 1, revision: 0, selected, third_party: oldRegistry.third_party || {} }
    await writeFile(configPath, JSON.stringify(selection, null, 2), { mode: 0o600, flag: 'wx' })
    console.log('已迁移新任务模型选择：config.json')
  }
}

const providers = join(targetHome, 'providers')
for (const entry of await readdir(new URL('../src/servers/providers/', import.meta.url), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  let definition
  try { definition = JSON.parse(await readFile(new URL(`../src/servers/providers/${entry.name}/definition.json`, import.meta.url), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') continue; throw error }
  const name = definition.config?.file
  if (name && await copyMissing(join(sourceHome, name), join(providers, name))) console.log(`已复制提供者配置：providers/${name}`)
}
console.log(`迁移完成：${targetHome}；旧目录未修改。`)
