#!/usr/bin/env node

// 职责：将旧目录和混合配置无损归入 config、pools、projects、runtime、uploads 五类目录。
import { access, chmod, cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'

function safeHome(value, fallback, name) {
  const directory = resolve(value || fallback)
  if (!isAbsolute(directory) || directory === parse(directory).root || directory === homedir()) throw new Error(`${name} 必须为独立的绝对目录`)
  return directory
}
async function exists(file) {
  try { await access(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
async function firstExisting(candidates) {
  for (const candidate of candidates) if (await exists(candidate)) return candidate
}

const dshHome = safeHome(process.env.DSH_HOME, join(homedir(), '.dsh'), 'DSH_HOME')
const legacyHome = safeHome(process.env.ELYSIUM_LEGACY_HOME, join(homedir(), '.elysium'), 'ELYSIUM_LEGACY_HOME')
const targetHome = join(dshHome, 'storages', 'elysium')
if (legacyHome === targetHome) throw new Error('旧 Elysium 目录与目标目录不能相同')

const configHome = join(targetHome, 'config'), poolsHome = join(targetHome, 'pools')
const migrationHome = join(targetHome, 'runtime', 'migrations', new Date().toISOString().replaceAll(':', '-'))
await Promise.all(['config', 'pools', 'projects', 'runtime', 'uploads'].map(name => mkdir(join(targetHome, name), { recursive: true })))

async function copyMissing(source, target) {
  if (!await exists(source)) return false
  if (await exists(target)) {
    const entries = await readdir(source, { withFileTypes: true }).catch(error => { if (error.code === 'ENOTDIR') return null; throw error })
    if (!entries) return false
    await mkdir(target, { recursive: true })
    for (const entry of entries) await copyMissing(join(source, entry.name), join(target, entry.name))
    return true
  }
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, errorOnExist: true, force: false })
  return true
}
async function archive(source, name) {
  if (!await exists(source)) return false
  const target = join(migrationHome, name)
  await mkdir(dirname(target), { recursive: true })
  if (await exists(target)) throw new Error(`迁移备份冲突：${target}`)
  await rename(source, target)
  return true
}
async function writeJson(target, value) {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temporary, target)
}
const insideLegacy = file => file === legacyHome || file.startsWith(`${legacyHome}${sep}`)

if (await exists(legacyHome)) {
  for (const name of ['projects', 'runtime', 'uploads']) await copyMissing(join(legacyHome, name), join(targetHome, name))
}

const directorsPath = join(poolsHome, 'directors.json')
const directorSource = await firstExisting([directorsPath, join(targetHome, 'directors.json'), join(legacyHome, 'directors.json')])
if (directorSource && directorSource !== directorsPath) await copyMissing(directorSource, directorsPath)

const registryPath = join(configHome, 'servers.json'), selectionPath = join(configHome, 'selection.json')
const registrySource = await firstExisting([registryPath, join(targetHome, 'servers.json'), join(legacyHome, 'servers.json'), join(dshHome, 'storages', 'servers.json'), join(dshHome, 'servers.json')])
let legacyRegistry
if (registrySource) {
  legacyRegistry = JSON.parse(await readFile(registrySource, 'utf8'))
  const { active, third_party, ...connections } = legacyRegistry
  if (registrySource !== registryPath || active !== undefined || third_party !== undefined) {
    if (registrySource === registryPath) await copyMissing(registrySource, join(migrationHome, 'original-config', 'servers.json'))
    await writeJson(registryPath, connections)
  }
}

const oldSelection = await firstExisting([selectionPath, join(targetHome, 'config.json'), join(legacyHome, 'config.json')])
if (!await exists(selectionPath)) {
  if (oldSelection) await copyMissing(oldSelection, selectionPath)
  else if (legacyRegistry) {
    const selected = {}
    if (legacyRegistry.active?.image) selected.image = legacyRegistry.active.image
    if (legacyRegistry.active?.video || legacyRegistry.active?.comfyui) selected.video = legacyRegistry.active.video || legacyRegistry.active.comfyui
    await writeJson(selectionPath, { version: 1, revision: 0, selected, third_party: legacyRegistry.third_party || {} })
  }
}

const providersHome = join(configHome, 'providers')
const providerFiles = []
for (const entry of await readdir(new URL('../src/servers/providers/', import.meta.url), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  let definition
  try { definition = JSON.parse(await readFile(new URL(`../src/servers/providers/${entry.name}/definition.json`, import.meta.url), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') continue; throw error }
  const name = definition.config?.file
  if (!name) continue
  providerFiles.push(name)
  const target = join(providersHome, name)
  const source = await firstExisting([target, join(configHome, name), join(targetHome, 'providers', name), join(legacyHome, 'providers', name), join(legacyHome, name), join(dshHome, name)])
  if (source && source !== target) await copyMissing(source, target)
  if (await exists(target)) await chmod(target, 0o600)
}

for (const [source, name] of [
  [join(targetHome, 'directors.json'), 'legacy-layout/directors.json'],
  [join(targetHome, 'servers.json'), 'legacy-layout/servers.json'],
  [join(targetHome, 'config.json'), 'legacy-layout/config.json'],
  [join(targetHome, 'providers'), 'legacy-layout/providers'],
  [join(dshHome, 'storages', 'servers.json'), 'legacy-dsh/storages-servers.json'],
  [join(dshHome, 'servers.json'), 'legacy-dsh/servers.json'],
]) if (!insideLegacy(source)) await archive(source, name)
for (const name of providerFiles) {
  await archive(join(dshHome, name), join('legacy-dsh', name))
  await archive(join(configHome, name), join('legacy-config', name))
}

if (await exists(legacyHome)) await archive(legacyHome, 'legacy-home')
console.log(`迁移完成：${targetHome}`)
console.log(`目录：config、pools、projects、runtime、uploads；旧数据备份：${migrationHome}`)
