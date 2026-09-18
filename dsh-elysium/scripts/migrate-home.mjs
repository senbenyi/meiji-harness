#!/usr/bin/env node

// 职责：将旧 ~/.elysium 和 DSH_HOME 散落配置合并到 DSH_HOME/storages/elysium，冲突先备份且不删除目标独有数据。
import { access, chmod, cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

function safeHome(value, fallback, name) {
  const path = resolve(value || fallback)
  if (!isAbsolute(path) || path === parse(path).root || path === homedir()) throw new Error(`${name} 必须为独立的绝对目录`)
  return path
}
async function exists(path) {
  try { await access(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
const dshHome = safeHome(process.env.DSH_HOME, join(homedir(), '.dsh'), 'DSH_HOME')
const sourceHome = safeHome(process.env.ELYSIUM_LEGACY_HOME, join(homedir(), '.elysium'), 'ELYSIUM_LEGACY_HOME')
const targetHome = join(dshHome, 'storages', 'elysium')
if (sourceHome === targetHome) throw new Error('旧 Elysium 目录与目标目录不能相同')
await mkdir(targetHome, { recursive: true })

let backupHome
async function backup(target) {
  backupHome ||= join(targetHome, '.migration-backups', new Date().toISOString().replaceAll(':', '-'))
  const backupPath = join(backupHome, relative(targetHome, target))
  if (!await exists(backupPath)) {
    await mkdir(dirname(backupPath), { recursive: true })
    await cp(target, backupPath, { recursive: true, errorOnExist: true, force: false })
  }
}
async function merge(source, target) {
  if (!await exists(source)) return false
  const sourceStat = await lstat(source)
  if (sourceStat.isDirectory()) {
    if (await exists(target) && !(await lstat(target)).isDirectory()) throw new Error(`迁移路径类型冲突：${target}`)
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source)) await merge(join(source, entry), join(target, entry))
    return true
  }
  if (await exists(target)) {
    if ((await lstat(target)).isDirectory()) throw new Error(`迁移路径类型冲突：${target}`)
    await backup(target)
  } else await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { force: true })
  return true
}

if (await exists(sourceHome)) for (const entry of await readdir(sourceHome)) {
  if (await merge(join(sourceHome, entry), join(targetHome, entry))) console.log(`已合并旧 Elysium 数据：${entry}`)
}

const oldRegistryPath = join(dshHome, 'servers.json'), registryPath = join(targetHome, 'servers.json'), configPath = join(targetHome, 'config.json')
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
  const source = name && join(dshHome, name), target = name && join(providers, name)
  if (name && await merge(source, target)) {
    await chmod(target, 0o600)
    console.log(`已合并提供者配置：providers/${name}`)
  }
}
if (backupHome) console.log(`冲突文件已备份：${backupHome}`)
console.log(`迁移完成：${targetHome}；旧目录未修改，目标独有数据已保留。`)
