// 职责：校验、读取和原子保存工作台与 Agent 共用的标准 Skill 文件。
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdir, readFile, readdir, rename, rm, writeFile } from '../files.js'
import { skillsRoot } from '../paths.js'
import { statusError } from '../../utils/errors.js'

const invalid = message => statusError(400, message)
const validName = name => typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)

function scalar(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch { throw invalid('Skill frontmatter 引号无效') }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

export function parseSkill(content) {
  if (typeof content !== 'string' || !content.startsWith('---\n')) throw invalid('Skill 缺少 frontmatter')
  const end = content.indexOf('\n---\n', 4)
  if (end < 0) throw invalid('Skill frontmatter 未结束')
  const metadata = {}, stack = [{ indent: -1, value: metadata }]
  for (const line of content.slice(4, end).split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = /^( *)([a-z][a-z0-9_-]*):(?: (.*))?$/.exec(line)
    if (!match || match[1].length % 2) throw invalid('Skill frontmatter 格式无效')
    const [, spaces, key, raw] = match
    while (stack.at(-1).indent >= spaces.length) stack.pop()
    if (stack.length === 0 || Object.hasOwn(stack.at(-1).value, key)) throw invalid('Skill frontmatter 字段重复或缩进无效')
    const value = raw === undefined || raw === '' ? {} : scalar(raw)
    stack.at(-1).value[key] = value
    if (raw === undefined || raw === '') stack.push({ indent: spaces.length, value })
  }
  if (!validName(metadata.name) || typeof metadata.description !== 'string' || !metadata.description.trim()) throw invalid('Skill 必须提供 kebab-case name 和非空 description')
  if (metadata.metadata !== undefined && (!metadata.metadata || typeof metadata.metadata !== 'object' || Array.isArray(metadata.metadata))) throw invalid('Skill metadata 无效')
  return { ...metadata, body: content.slice(end + 5) }
}

async function atomicWrite(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}

export function createSkillsStore() {
  const referencePath = (name, relative) => {
    if (typeof relative !== 'string' || !/^[a-z0-9][a-z0-9/.-]*\.md$/.test(relative) || relative.split('/').includes('..')) throw invalid('Skill 引用路径无效')
    return join(path(name), 'references', relative)
  }
  const path = name => {
    if (!validName(name)) throw invalid('Skill 名称无效')
    return join(skillsRoot(), name)
  }
  const get = async name => {
    const content = await readFile(join(path(name), 'SKILL.md'), 'utf8')
    const parsed = parseSkill(content)
    if (parsed.name !== name) throw invalid('Skill name 与目录名不一致')
    return { ...parsed, content }
  }
  const list = async kind => {
    const entries = await readdir(skillsRoot(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !validName(entry.name)) continue
      const item = await get(entry.name).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (item && (!kind || item.metadata?.kind === kind)) items.push(item)
    }
    return items.sort((a, b) => (a.metadata?.order ?? 0) - (b.metadata?.order ?? 0) || a.name.localeCompare(b.name))
  }
  const save = async (name, content) => {
    const parsed = parseSkill(content)
    if (parsed.name !== name) throw invalid('Skill name 与目录名不一致')
    await mkdir(path(name), { recursive: true })
    await atomicWrite(join(path(name), 'SKILL.md'), content)
    return { ...parsed, content }
  }
  const reference = async (name, relative) => {
    return readFile(referencePath(name, relative), 'utf8')
  }
  const saveReference = async (name, relative, content) => {
    if (typeof content !== 'string') throw invalid('Skill 引用内容无效')
    const target = referencePath(name, relative)
    await mkdir(dirname(target), { recursive: true })
    await atomicWrite(target, content)
    return content
  }
  const remove = async name => { await get(name); await rm(path(name), { recursive: true }); return { deleted: true } }
  const seed = async (name, source) => {
    const target = path(name)
    const existing = await readdir(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
    if (existing) return false
    await mkdir(skillsRoot(), { recursive: true })
    const temporary = join(skillsRoot(), `.${name}.${randomUUID()}.tmp`)
    async function copy(from, to) {
      await mkdir(to, { recursive: true })
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const sourcePath = join(from, entry.name), targetPath = join(to, entry.name)
        if (entry.isDirectory()) await copy(sourcePath, targetPath)
        else if (entry.isFile()) await writeFile(targetPath, await readFile(sourcePath), { flag: 'wx', mode: 0o600 })
      }
    }
    try {
      await copy(source, temporary)
      const parsed = parseSkill(await readFile(join(temporary, 'SKILL.md'), 'utf8'))
      if (parsed.name !== name) throw invalid('Skill name 与目录名不一致')
      await rename(temporary, target)
      return true
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') return false
      throw error
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
  return { get, list, save, reference, saveReference, remove, seed }
}
