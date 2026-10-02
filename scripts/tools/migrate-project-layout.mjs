#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { PROJECT_STEPS, STUDIO_STORAGE_ROOT, formatProjectId, projectDirectories, safeName } from '../../lib/storage/layout.js'

const args = parseArgs(process.argv.slice(2))
if (!args.project) usage('缺少 --project=<旧项目ID>')
if (args.apply && !args.offline) usage('执行迁移前必须停止 dsh web，并显式增加 --offline')

const storageRoot = resolve(args.storage || STUDIO_STORAGE_ROOT)
const workspace = resolve(args.workspace || process.cwd())
const projectsDir = join(storageRoot, 'projects')
const bindingsDir = join(storageRoot, 'bindings')
const sourceIds = [args.project, args.canvasProject].filter(Boolean)
const wrappers = await Promise.all(sourceIds.map((id) => readJson(join(projectsDir, `${id}.json`))))
const baseWrapper = wrappers[0]
const base = structuredClone(baseWrapper.record)
const canvas = wrappers[1]?.record?.legacyCanvas || base.legacyCanvas
const targetId = args.target || formatProjectId(base.createdAt)
if (!/^\d{17}$/.test(targetId)) usage('--target 必须是 17 位时间项目ID')

const targetFile = join(projectsDir, `${targetId}.json`)
if (!sourceIds.includes(targetId) && existsSync(targetFile)) throw new Error(`目标项目已存在: ${targetFile}`)

const layout = projectDirectories(storageRoot, targetId)
const migrationId = formatProjectId()
const backupDir = join(storageRoot, 'trash', `project-layout-${targetId}-${migrationId}`)
const copies = []
const missing = []
const usedNames = new Set()

base.id = targetId
base.title = String(base.title || '未命名短剧项目').trim()
if (/^短剧项目\s+session-/.test(base.title)) base.title = inferProjectTitle(canvas) || '未命名短剧项目'
base.updatedAt = new Date().toISOString()
base.sourceDocuments = structuredClone(base.sourceDocuments || {})

let sourceIndex = 0
for (const document of Object.values(base.sourceDocuments)) {
  sourceIndex++
  const original = resolveStoredPath(document.logicalKey)
  const extension = extname(original) || '.txt'
  const filename = uniqueName(PROJECT_STEPS.source, `step-01-source-${String(sourceIndex).padStart(3, '0')}-${safeName(document.title, 'source')}`, extension)
  const logicalKey = `projects/${targetId}/${PROJECT_STEPS.source}/${filename}`
  if (registerCopy(original, join(storageRoot, logicalKey), logicalKey)) document.logicalKey = logicalKey
}

if (canvas) {
  base.legacyCanvas = structuredClone(canvas)
  base.legacyCanvas.projectId = targetId
  for (const node of base.legacyCanvas.nodes || []) {
    for (const field of ['file', 'media']) {
      if (!node[field]) continue
      const original = resolveStoredPath(node[field])
      const step = stepForNode(node)
      const extension = extname(original) || extensionForKind(node.kind)
      const filename = uniqueName(step, `${step.slice(0, 7)}-${safeName(node.title, node.kind || 'artifact')}`, extension)
      const logicalKey = `projects/${targetId}/${step}/${filename}`
      if (registerCopy(original, join(storageRoot, logicalKey), logicalKey)) {
        node[field] = logicalKey
      } else if (args.allowMissing) {
        node.migrationMissingFiles = [...(node.migrationMissingFiles || []), node[field]]
        delete node[field]
      }
    }
  }
}

const bindingUpdates = []
if (existsSync(bindingsDir)) {
  for (const name of await readdir(bindingsDir)) {
    if (!name.endsWith('.json')) continue
    const file = join(bindingsDir, name)
    const wrapper = await readJson(file)
    if (!sourceIds.includes(wrapper.record?.projectId)) continue
    const updated = structuredClone(wrapper)
    updated.version = Number(updated.version || 0) + 1
    updated.record.projectId = targetId
    updated.record.updatedAt = new Date().toISOString()
    bindingUpdates.push({ file, name, before: wrapper, after: updated })
  }
}

const legacyDirectories = []
for (const id of sourceIds) {
  const path = join(workspace, 'source', id)
  if (existsSync(path)) legacyDirectories.push({ path, archiveName: `workspace-source-${safeName(id)}` })
}
for (const sessionId of new Set(wrappers.map(({ record }) => record?.legacyCanvas?.sessionId).filter(Boolean))) {
  const path = join(workspace, 'canvas', sessionId)
  if (existsSync(path)) legacyDirectories.push({ path, archiveName: `workspace-canvas-${safeName(sessionId)}` })
}

const report = {
  mode: args.apply ? 'apply' : 'dry-run',
  storageRoot,
  workspace,
  sourceProjectIds: sourceIds,
  targetProjectId: targetId,
  targetDirectory: layout.project,
  copies: copies.map(({ original, logicalKey }) => ({ from: original, to: logicalKey })),
  missing,
  bindings: bindingUpdates.map(({ name }) => name),
  archivedLegacyDirectories: legacyDirectories.map(({ path, archiveName }) => ({ from: path, to: join(backupDir, archiveName) })),
}

if (missing.length && !args.allowMissing) {
  console.log(JSON.stringify(report, null, 2))
  throw new Error(`有 ${missing.length} 个源文件不存在，未执行迁移`)
}

if (!args.apply) {
  console.log(JSON.stringify(report, null, 2))
  console.log('\n预演完成；确认后增加 --apply 执行。')
  process.exit(0)
}

await Promise.all(Object.values(layout).map((path) => mkdir(path, { recursive: true })))
await mkdir(backupDir, { recursive: true })

for (let index = 0; index < wrappers.length; index++) {
  await copyVerified(join(projectsDir, `${sourceIds[index]}.json`), join(backupDir, `project-${sourceIds[index]}.json`))
}
for (const binding of bindingUpdates) await copyVerified(binding.file, join(backupDir, `binding-${binding.name}`))
for (const copy of copies) await copyVerified(copy.original, copy.destination)

await atomicJson(targetFile, { version: 1, record: base })
for (const binding of bindingUpdates) await atomicJson(binding.file, binding.after)
for (const id of sourceIds) {
  if (id !== targetId) await rm(join(projectsDir, `${id}.json`))
}
for (const legacy of legacyDirectories) await rename(legacy.path, join(backupDir, legacy.archiveName))

await atomicJson(join(backupDir, 'migration-manifest.json'), report)
console.log(JSON.stringify({ ...report, backupDirectory: backupDir, status: 'completed' }, null, 2))

function resolveStoredPath(logicalKey) {
  const value = String(logicalKey || '')
  return value.startsWith('projects/') ? join(storageRoot, value) : join(workspace, value)
}

function registerCopy(original, destination, logicalKey) {
  if (!existsSync(original)) {
    missing.push(original)
    return false
  }
  copies.push({ original, destination, logicalKey })
  return true
}

function inferProjectTitle(legacyCanvas) {
  for (const node of legacyCanvas?.nodes || []) {
    const title = String(node.title || '').trim()
    const match = title.match(/^(?:项目简报|故事大纲)\s*[·:：-]\s*(.+)$/)
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function stepForNode(node) {
  const text = `${node.title || ''} ${node.group || ''}`
  if (/分集|大纲/.test(text)) return PROJECT_STEPS.episodePlan
  if (/剧本|镜头表/.test(text)) return PROJECT_STEPS.scripts
  if (/角色|场景|资产/.test(text)) return PROJECT_STEPS.assets
  if (/分镜|prompt/i.test(text)) return PROJECT_STEPS.storyboards
  if (/拼接|时间线/.test(text)) return PROJECT_STEPS.assembly
  if (/质检|审核|报告/.test(text)) return PROJECT_STEPS.qualityReview
  if (/交付|成片/.test(text)) return PROJECT_STEPS.delivery
  if (['image', 'video', 'audio'].includes(node.kind)) return PROJECT_STEPS.generation
  return PROJECT_STEPS.development
}

function extensionForKind(kind) {
  if (kind === 'image') return '.png'
  if (kind === 'video') return '.mp4'
  if (kind === 'audio') return '.wav'
  return '.html'
}

function uniqueName(step, stem, extension) {
  let version = 1
  let name
  do {
    name = `${stem}-v${String(version++).padStart(3, '0')}${extension}`
  } while (usedNames.has(`${step}/${name}`))
  usedNames.add(`${step}/${name}`)
  return name
}

async function copyVerified(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
  const [sourceStat, targetStat] = await Promise.all([stat(source), stat(destination)])
  if (sourceStat.size !== targetStat.size) throw new Error(`复制校验失败: ${source}`)
  const [sourceHash, targetHash] = await Promise.all([sha256(source), sha256(destination)])
  if (sourceHash !== targetHash) throw new Error(`复制哈希校验失败: ${source}`)
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n')
  await rename(temporary, file)
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

function parseArgs(values) {
  const result = { apply: false }
  for (const value of values) {
    if (value === '--apply') result.apply = true
    else if (value === '--offline') result.offline = true
    else if (value === '--allow-missing') result.allowMissing = true
    else if (value.startsWith('--project=')) result.project = value.slice(10)
    else if (value.startsWith('--canvas-project=')) result.canvasProject = value.slice(17)
    else if (value.startsWith('--target=')) result.target = value.slice(9)
    else if (value.startsWith('--storage=')) result.storage = value.slice(10)
    else if (value.startsWith('--workspace=')) result.workspace = value.slice(12)
    else usage(`未知参数: ${value}`)
  }
  return result
}

function usage(message) {
  if (message) console.error(message)
  console.error('用法: node scripts/tools/migrate-project-layout.mjs --project=<ID> [--canvas-project=<ID>] [--workspace=<路径>] [--storage=<路径>] [--target=<17位ID>] [--allow-missing] [--offline --apply]')
  process.exit(2)
}
