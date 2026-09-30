// 内置技能（插件源码，只读）。代码按字段直接读取，不经 Harness：
//   stages/<id>/     阶段技能：skill.json + common / generate / review / revise（可编辑）+ protocol（程序解析依赖，只读）
//   guidance/<id>/   指导技能：skill.json + common / review + stages/<阶段>.md（本阶段要求）
//   shared/<id>.md   共享模块：被多个阶段引用的单段正文
//   constraints/<id>.md 固定约束：由阶段显式启用，允许空文本，页面/API 不可编辑
//   agent/panel.md   会话说明：唯一注册给 Harness 的技能（会话 agent 使用，不参与提示词组装）
// 面板修改（基础层）与本剧补充由 server/data/skill-store.js 叠加在内置之上。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
export const editableParts = ['common', 'generate', 'review', 'revise']
export const guidanceStages = ['outline', 'shots', 'seconds', 'storyboard']
const stageKeys = new Set(['id', 'kind', 'label', 'logLabel', 'output', 'languageMode', 'panel', 'guidanceStage', 'assetStages', 'shared', 'related', 'fields', 'order', 'fixedConstraints'])
const guidanceKeys = new Set(['id', 'kind', 'label', 'defaultEnabled', 'assetTypes', 'stages'])
const outputs = new Set(['json', 'text', 'image', 'video'])
const sharedLabels = {
  'review-protocol': '审核通用协议', 'camera-review': '镜头类审核', 'revise-boundary': '修订边界',
  'tail-frame': '尾帧协议', language: '语言', 'language-revise': '修订时的语言',
}

export const textHash = text => createHash('sha256').update(String(text || '')).digest('hex').slice(0, 12)
const read = path => readFileSync(path, 'utf8').replace(/\s+$/, '')
const skillError = message => new Error('技能结构错误：' + message)

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) { throw skillError(`${path} 无法读取：${error.message}`) }
}

function mdFiles(dir) {
  return readdirSync(dir).filter(name => name.endsWith('.md')).map(name => name.slice(0, -3)).sort()
}

function loadStage(base, id) {
  const dir = join(base, 'stages', id)
  const meta = readJson(join(dir, 'skill.json'))
  if (meta.id !== id || meta.kind !== 'stage') throw skillError(`stages/${id}/skill.json 的 id 或 kind 不符`)
  for (const key of Object.keys(meta)) if (!stageKeys.has(key)) throw skillError(`stages/${id} 未知字段 ${key}`)
  if (!meta.label || !meta.logLabel || !outputs.has(meta.output)) throw skillError(`stages/${id} 缺少 label / logLabel / output`)
  const fields = meta.fields || []
  if (meta.fixedConstraints !== undefined && typeof meta.fixedConstraints !== 'boolean') throw skillError(`stages/${id} fixedConstraints 必须为布尔值`)
  if (!Array.isArray(fields) || (!fields.includes('generate') && !meta.fixedConstraints) || fields.some(field => ![...editableParts, 'protocol'].includes(field))) throw skillError(`stages/${id} fields 无效`)
  const files = mdFiles(dir)
  if (files.join() !== [...fields].sort().join()) throw skillError(`stages/${id} 的 md 文件（${files.join('、')}）与 fields 不一致`)
  for (const [part, refs] of Object.entries(meta.shared || {})) {
    if (!['common', 'review', 'revise'].includes(part)) throw skillError(`stages/${id} shared.${part} 无效`)
    for (const ref of refs) if (!sharedLabels[ref]) throw skillError(`stages/${id} 引用了不存在的共享模块 ${ref}`)
  }
  const parts = Object.fromEntries(editableParts.map(part => [part, fields.includes(part) ? read(join(dir, part + '.md')) : '']))
  // 空文件有效；缺失文件仍报错，不静默忽略配置问题。
  const constraints = meta.fixedConstraints ? { constraints: read(join(base, 'constraints', id + '.md')) } : {}
  return { ...meta, fields, parts, ...constraints, protocol: fields.includes('protocol') ? read(join(dir, 'protocol.md')) : '' }
}

function loadGuidance(base, name) {
  const dir = join(base, 'guidance', name)
  const meta = readJson(join(dir, 'skill.json'))
  const id = 'guidance-' + name
  if (meta.id !== id || meta.kind !== 'guidance') throw skillError(`guidance/${name}/skill.json 的 id 或 kind 不符`)
  for (const key of Object.keys(meta)) if (!guidanceKeys.has(key)) throw skillError(`guidance/${name} 未知字段 ${key}`)
  if (!meta.label || typeof meta.defaultEnabled !== 'boolean' || !Array.isArray(meta.assetTypes)) throw skillError(`guidance/${name} 缺少 label / defaultEnabled / assetTypes`)
  const stages = Object.keys(meta.stages || {})
  if (stages.some(stage => !guidanceStages.includes(stage))) throw skillError(`guidance/${name} 阶段落点无效`)
  if (mdFiles(dir).join() !== 'common,review') throw skillError(`guidance/${name} 应只有 common.md 与 review.md`)
  const stageFiles = existsSync(join(dir, 'stages')) ? mdFiles(join(dir, 'stages')) : []
  if (stageFiles.join() !== [...stages].sort().join()) throw skillError(`guidance/${name}/stages 与 skill.json 的阶段落点不一致`)
  const parts = { common: read(join(dir, 'common.md')), review: read(join(dir, 'review.md')) }
  for (const stage of stages) parts[stage] = read(join(dir, 'stages', stage + '.md'))
  return { ...meta, name, fields: ['common', ...stages, 'review'], parts, protocol: '' }
}

function loadShared(base, name) {
  return { id: 'shared-' + name, kind: 'shared', name, label: sharedLabels[name], fields: ['text'], parts: { text: read(join(base, 'shared', name + '.md')) }, protocol: '' }
}

function loadCatalog(base) {
  const skills = new Map()
  const stageDirs = readdirSync(join(base, 'stages')).filter(name => statSync(join(base, 'stages', name)).isDirectory())
  for (const skill of stageDirs.map(id => loadStage(base, id)).sort((a, b) => a.order - b.order)) skills.set(skill.id, skill)
  for (const name of readdirSync(join(base, 'guidance')).sort()) skills.set('guidance-' + name, loadGuidance(base, name))
  for (const name of mdFiles(join(base, 'shared'))) {
    if (!sharedLabels[name]) throw skillError(`shared/${name}.md 未登记`)
    skills.set('shared-' + name, loadShared(base, name))
  }
  for (const skill of skills.values()) {
    if (skill.kind === 'stage') for (const stage of skill.related || []) if (!skills.has(stage)) throw skillError(`${skill.id} related ${stage} 不存在`)
  }
  const guidanceOrder = ['action', 'martial', 'dialogue', 'expression', 'sound']
  for (const name of guidanceOrder) if (!skills.has('guidance-' + name)) throw skillError(`缺少指导技能 ${name}`)
  const used = new Set(['review-protocol', 'language', 'language-revise'])
  for (const skill of skills.values()) for (const refs of Object.values(skill.shared || {})) for (const ref of refs) used.add(ref)
  const unused = Object.keys(sharedLabels).filter(name => !used.has(name) || !skills.has('shared-' + name))
  if (unused.length) throw skillError(`共享模块缺失或未被引用：${unused.join('、')}`)
  return { skills, guidance: guidanceOrder.map(name => 'guidance-' + name) }
}

let cache = null
const catalog = () => (cache ||= loadCatalog(root))

// 全部内置技能（阶段、指导、共享）。返回副本，调用方可自由叠加。
export function builtinSkills() {
  return [...catalog().skills.values()].map(skill => structuredClone(skill))
}

export function builtinSkill(id) {
  const skill = catalog().skills.get(id)
  if (!skill) throw Object.assign(new Error('技能不存在：' + id), { status: 404 })
  return structuredClone(skill)
}

export const isSkill = id => catalog().skills.has(id)
export const stageSkillIds = () => [...catalog().skills.values()].filter(skill => skill.kind === 'stage').map(skill => skill.id)
export const guidanceSkillIds = () => [...catalog().guidance]
export const guidanceName = id => id.replace(/^guidance-/, '')

// 会话 agent 的技能：唯一注册给 Harness，不参与提示词组装。
export function agentSkills() {
  const path = join(root, 'agent', 'panel.md')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(readFileSync(path, 'utf8'))
  if (!match) throw skillError('agent/panel.md 缺少 frontmatter')
  const name = /^name:\s*(.+)$/m.exec(match[1])?.[1].trim()
  const description = /^description:\s*(.+)$/m.exec(match[1])?.[1].trim()
  if (!name || !description) throw skillError('agent/panel.md frontmatter 无效')
  return [{ name, description, category: 'gongyong', pane: null, feature: 'panel', mode: 'generate', source: 'runtime', content: match[2].trim(), path,
    resourceBase: { kind: 'opaque', description: `Meiji skill ${name}（正文已注入会话，勿再打开本地 md）` } }]
}

// 结构校验（测试与启动时调用）：全部技能可加载、字段与文件一致、共享模块齐全且都被引用。dir 缺省为内置目录。
export function validateSkills(dir = root) {
  const { skills } = loadCatalog(dir)
  if (dir === root) { cache = null; agentSkills() }
  return [...skills.keys()]
}
