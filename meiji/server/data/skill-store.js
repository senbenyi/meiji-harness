// 技能三层：内置（skills/，只读）→ 基础（面板修改，全局，替换内置）→ 本剧（项目索引 skills，追加）。
// 基础层存于 $DSH_HOME/storages/meiji/skills/<id>.json，只存改过的字段、内容哈希、所基于的内置哈希与上一版本；
// 插件升级只更新内置，不覆盖基础层。任务开始时用 loadSkillSet 固定一次组合（见 task-store startExecution）。
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { builtinSkill, builtinSkills, editableParts, guidanceName, guidanceSkillIds, isSkill, textHash } from '../../skills/load.js'

const MAX_BASE = 60000
const MAX_ADDITION = 20000
const validId = /^[a-z][a-z0-9-]{0,63}$/
const now = () => new Date().toISOString()
export const skillsRoot = home => join(resolve(home), 'storages', 'meiji', 'skills')
const badRequest = message => Object.assign(new Error(message), { status: 400 })

// 可编辑的字段：阶段技能 common/generate/review/revise（协议只读）；指导技能 common/review/各阶段；共享模块 text。
export function editableFields(skill) {
  if (skill.fixedConstraints) return []
  if (skill.kind === 'stage') return skill.fields.filter(field => editableParts.includes(field))
  return [...skill.fields]
}

async function readOverride(home, id) {
  if (!validId.test(id)) throw badRequest('技能 ID 无效')
  try { return JSON.parse(await readFile(join(skillsRoot(home), id + '.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function writeOverride(home, id, value) {
  const dir = skillsRoot(home)
  await mkdir(dir, { recursive: true })
  const file = join(dir, id + '.json')
  if (!Object.keys(value.fields).length && !Object.keys(value.previous || {}).length) { await rm(file, { force: true }); return }
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

// 内置 + 基础：每个字段的最终文本、所在层与哈希；内置在基础修改后又更新时标记 outdated。
export function mergeBase(skill, override) {
  const parts = { ...skill.parts }
  const layers = {}
  const outdated = []
  const allowed = editableFields(skill)
  for (const field of Object.keys(skill.parts)) {
    const base = allowed.includes(field) ? override?.fields?.[field] : null
    layers[field] = base ? 'base' : 'builtin'
    if (base) {
      parts[field] = base.text
      if (base.builtinHash !== textHash(skill.parts[field])) outdated.push(field)
    }
  }
  return { ...skill, builtin: skill.parts, parts, layers, outdated, previous: Object.keys(override?.previous || {}).filter(field => allowed.includes(field)), updatedAt: allowed.length ? override?.updatedAt || null : null }
}

export function skillStore(home) {
  const writes = new Map()
  const serialize = (id, job) => {
    const run = (writes.get(id) || Promise.resolve()).then(job, job)
    writes.set(id, run.catch(() => {}))
    return run
  }
  return {
    async list() {
      const overrides = await readAllOverrides(home)
      return builtinSkills().filter(skill => !skill.codeOnly).map(skill => mergeBase(skill, overrides.get(skill.id)))
    },
    async get(id) {
      if (!isSkill(id)) throw Object.assign(new Error('技能不存在'), { status: 404 })
      return mergeBase(builtinSkill(id), await readOverride(home, id))
    },
    // 保存基础修改：与内置相同的字段视为恢复内置；上一版本保留一份用于撤回。
    save(id, fields) {
      return serialize(id, async () => {
        const skill = builtinSkill(id)
        const allowed = editableFields(skill)
        if (!fields || typeof fields !== 'object') throw badRequest('缺少字段内容')
        const override = await readOverride(home, id) || { id, fields: {}, previous: {} }
        for (const [field, text] of Object.entries(fields)) {
          if (!allowed.includes(field)) throw badRequest(`字段 ${field} 不可编辑`)
          if (typeof text !== 'string' || text.length > MAX_BASE) throw badRequest(`字段内容须为字符串，且不超过 ${MAX_BASE} 字`)
          const value = text.replace(/\s+$/, '')
          const current = override.fields[field]
          if ((current?.text ?? skill.parts[field]) === value) continue
          override.previous[field] = current ? { text: current.text, hash: current.hash, builtinHash: current.builtinHash } : { builtin: true }
          if (value === skill.parts[field]) delete override.fields[field]
          else override.fields[field] = { text: value, hash: textHash(value), builtinHash: textHash(skill.parts[field]) }
        }
        override.updatedAt = now()
        await writeOverride(home, id, override)
        return mergeBase(skill, override)
      })
    },
    // 恢复内置（to: builtin）或撤回到上一版本（to: previous）；field 为空时作用于全部字段。
    reset(id, { to = 'builtin', field = '' } = {}) {
      return serialize(id, async () => {
        const skill = builtinSkill(id)
        const override = await readOverride(home, id) || { id, fields: {}, previous: {} }
        const targets = field ? [field] : editableFields(skill)
        if (field && !editableFields(skill).includes(field)) throw badRequest(`字段 ${field} 不可编辑`)
        if (!['builtin', 'previous'].includes(to)) throw badRequest('恢复目标无效')
        for (const name of targets) {
          const current = override.fields[name]
          if (to === 'builtin') {
            if (!current) continue
            override.previous[name] = { text: current.text, hash: current.hash, builtinHash: current.builtinHash }
            delete override.fields[name]
          } else {
            const previous = override.previous[name]
            if (!previous) continue
            override.previous[name] = current ? { text: current.text, hash: current.hash, builtinHash: current.builtinHash } : { builtin: true }
            if (previous.builtin) delete override.fields[name]
            else override.fields[name] = { text: previous.text, hash: textHash(previous.text), builtinHash: previous.builtinHash || textHash(skill.parts[name]) }
          }
        }
        override.updatedAt = now()
        await writeOverride(home, id, override)
        return mergeBase(skill, override)
      })
    },
  }
}

async function readAllOverrides(home) {
  const overrides = new Map()
  let files = []
  try { files = await readdir(skillsRoot(home)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const file of files.filter(name => name.endsWith('.json'))) {
    const id = file.slice(0, -5)
    if (!isSkill(id)) continue
    overrides.set(id, await readOverride(home, id))
  }
  return overrides
}

// ---- 本剧层（项目索引 skills）----

// 缺省：没有补充，启用默认开启的指导，没有指导素材。
export function projectSkills(value) {
  const defaults = guidanceSkillIds().filter(id => builtinSkill(id).defaultEnabled).map(guidanceName)
  return {
    additions: structuredClone(value?.additions || {}),
    guidance: { enabled: Array.isArray(value?.guidance?.enabled) ? [...value.guidance.enabled] : defaults },
    assets: structuredClone(value?.assets || {}),
  }
}

// 保存本剧补充：只接受阶段与指导技能的可编辑字段；空文本删除该字段。
export function additionsPatch(value, id, fields) {
  if (!isSkill(id)) throw Object.assign(new Error('技能不存在'), { status: 404 })
  const skill = builtinSkill(id)
  if (skill.kind === 'shared') throw badRequest('共享模块没有本剧补充')
  const allowed = editableFields(skill)
  const skills = projectSkills(value)
  const current = { ...skills.additions[id] }
  for (const [field, text] of Object.entries(fields || {})) {
    if (!allowed.includes(field)) throw badRequest(`字段 ${field} 不可补充`)
    if (typeof text !== 'string' || text.length > MAX_ADDITION) throw badRequest(`本剧补充须为字符串，且不超过 ${MAX_ADDITION} 字`)
    if (text.trim()) current[field] = text.trim()
    else delete current[field]
  }
  if (Object.keys(current).length) skills.additions[id] = current
  else delete skills.additions[id]
  return skills
}

export function guidancePatch(value, enabled) {
  const names = guidanceSkillIds().map(guidanceName)
  if (!Array.isArray(enabled) || enabled.some(name => !names.includes(name))) throw badRequest('指导技能无效')
  const skills = projectSkills(value)
  skills.guidance.enabled = names.filter(name => enabled.includes(name))
  return skills
}

// ---- 任务使用的技能组合 ----

// 固定一次技能组合：内置 + 基础（读自运行数据目录）+ 本剧。同一任务内的生成、审核、修订都用这一份。
export async function loadSkillSet(home, projectValue) {
  const overrides = home ? await readAllOverrides(home) : new Map()
  return buildSkillSet(overrides, projectValue)
}

// 没有任务上下文时（测试、离线组装）：只用内置 + 本剧。
export const builtinSkillSet = projectValue => buildSkillSet(new Map(), projectValue)

function buildSkillSet(overrides, projectValue) {
  const skills = {}
  const project = projectSkills(projectValue)
  for (const skill of builtinSkills()) {
    const merged = mergeBase(skill, overrides.get(skill.id))
    skills[skill.id] = { parts: merged.parts, layers: merged.layers, review: skill.review, reviewRules: skill.reviewRules, ...(skill.fixedConstraints ? { constraints: skill.constraints, rules: skill.rules } : {}) }
    if (skill.fixedConstraints && !editableFields(skill).length) delete project.additions[skill.id]
  }
  return { skills, project }
}

// 任务记录与历史中的技能条目：所用层与内容哈希。
export function skillUse(set, id) {
  const skill = set.skills[id]
  const addition = set.project.additions[id]
  const layers = ['builtin']
  if (Object.values(skill.layers).includes('base')) layers.push('base')
  if (addition && Object.keys(addition).length) layers.push('project')
  const content = [skill.parts, addition || {}]
  if (Object.hasOwn(skill, 'constraints')) content.push(skill.constraints)
  return { id, layers, hash: textHash(JSON.stringify(content)) }
}
