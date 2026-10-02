// 每个功能一份基础生产规则（task/）和一份审核 skill（review/）；生成、审核和修订由对应 Model 编排。
// 两个目录都只放平铺的功能 Markdown；注册信息和输出协议由代码管理。
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stageCatalog } from './skill-catalog.js'
import { protocols } from './output-protocols.js'

const root = dirname(fileURLToPath(import.meta.url))
export const editableParts = []
export const guidanceStages = ['outline', 'shots', 'seconds', 'storyboard']
export const textHash = text => createHash('sha256').update(String(text || '')).digest('hex').slice(0, 12)
const read = path => readFileSync(path, 'utf8').replace(/\s+$/, '')
const skillError = message => new Error('技能结构错误：' + message)
function loadCatalog(base) {
  const dir = join(base, 'task')
  const expected = new Set(stageCatalog.flatMap(meta => [meta.constraintFile, ...Object.values(meta.constraintVariants || {})]).filter(Boolean))
  const entries = readdirSync(dir).filter(name => !name.startsWith('.'))
  for (const name of entries) if (!expected.has(name)) throw skillError(`md 文件 ${name} 未登记；task 只允许平铺功能约束`)
  // 审核 skill：每个有自审的功能一份，平铺在 review/，与生成规则分开维护。
  const reviewDir = join(base, 'review')
  const expectedReview = new Set(stageCatalog.flatMap(meta => [meta.reviewFile, ...Object.values(meta.reviewVariants || {})]).filter(Boolean))
  const reviewEntries = readdirSync(reviewDir).filter(name => !name.startsWith('.'))
  for (const name of reviewEntries) if (!expectedReview.has(name)) throw skillError(`审核 md 文件 ${name} 未登记；review 只允许平铺功能审核 skill`)
  const skills = new Map()
  for (const meta of stageCatalog) {
    const rules = Object.fromEntries(Object.entries(meta.constraintVariants || {}).map(([key, file]) => [key, read(join(dir, file))]))
    const constraints = meta.codeOnly ? '' : read(join(dir, meta.constraintFile))
    const reviewRules = Object.fromEntries(Object.entries(meta.reviewVariants || {}).map(([key, file]) => [key, read(join(reviewDir, file))]))
    const review = meta.reviewFile ? read(join(reviewDir, meta.reviewFile)) : ''
    skills.set(meta.id, { ...meta, rules, constraints, reviewRules, review, parts: { common: '', generate: constraints, review, revise: '' }, protocol: protocols[meta.id] || '' })
  }
  return { skills, guidance: [] }
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
export function sessionSkills() {
  const path = join(root, 'session', 'panel.md')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(readFileSync(path, 'utf8'))
  if (!match) throw skillError('session/panel.md 缺少 frontmatter')
  const name = /^name:\s*(.+)$/m.exec(match[1])?.[1].trim()
  const description = /^description:\s*(.+)$/m.exec(match[1])?.[1].trim()
  if (!name || !description) throw skillError('session/panel.md frontmatter 无效')
  return [{ name, description, category: 'gongyong', pane: null, feature: 'panel', mode: 'generate', source: 'runtime', content: match[2].trim(), path,
    resourceBase: { kind: 'opaque', description: `Meiji skill ${name}（正文已注入会话，勿再打开本地 md）` } }]
}

// 结构校验（测试与启动时调用）：全部技能可加载、字段与文件一致、共享模块齐全且都被引用。dir 缺省为内置目录。
export function validateSkills(dir = root) {
  const { skills } = loadCatalog(dir)
  if (dir === root) { cache = null; sessionSkills() }
  return [...skills.keys()]
}
