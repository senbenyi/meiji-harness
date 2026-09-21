// 职责：以标准 Skill 为导演的唯一存储形式，提供列表、全文编辑和排序。
import { randomBytes } from 'node:crypto'
import { createSkillsStore, parseSkill } from './skills.js'
import { flowSteps } from './flow.js'
import { statusError } from '../../utils/errors.js'

const invalid = message => statusError(400, message)
const files = ['SKILL.md', ...flowSteps.map(step => `${step}.md`)]
const seriesTemplate = '# 导演总览\n\n- 集数：固定 2 集；单集 60–120 秒。\n'
const scriptTemplate = '# 导演剧本\n\n## 叙事节奏\n\n## 单集结构与钩子\n'
const storyboardTemplate = '# 导演分镜\n\n## 镜头语言\n\n## 提示词额外要求\n'
const summary = item => ({ name: item.name, display_name: item.metadata?.display_name || item.name,
  description: item.description, order: item.metadata?.order ?? 0 })

export function createDirectorStore() {
  const skills = createSkillsStore()
  const list = async () => (await skills.list('director')).map(summary)
  const has = async name => (await list()).some(item => item.name === name)
  const get = async name => {
    const item = await skills.get(name)
    if (item.metadata?.kind !== 'director') throw invalid('导演 Skill 不存在')
    const references = await Promise.all(files.slice(1).map(file => skills.reference(name, file).catch(error => {
      if (error.code === 'ENOENT') return ''
      throw error
    })))
    return { ...summary(item), content: item.content, files: Object.fromEntries([['SKILL.md', item.content], ...files.slice(1).map((file, index) => [file, references[index]])]) }
  }
  const save = async ({ name, file, content }) => {
    if (!files.includes(file)) throw invalid('导演文件名无效')
    if (file === 'SKILL.md') {
      if (parseSkill(content).metadata?.kind !== 'director') throw invalid('导演 Skill 的 metadata.kind 必须为 director')
      await skills.save(name, content)
    } else {
      await get(name)
      await skills.saveReference(name, file, content)
    }
    return get(name)
  }
  const create = async ({ display_name, description, content: suppliedContent }) => {
    if (typeof display_name !== 'string' || !display_name.trim() || description !== undefined && typeof description !== 'string') throw invalid('请输入导演显示名和描述')
    const name = `director-${randomBytes(4).toString('hex')}`
    const order = (await list()).length
    let content = `---\nname: ${name}\ndescription: ${JSON.stringify(description?.trim() || display_name.trim() + '的导演风格')}\nmetadata:\n  kind: director\n  display_name: ${JSON.stringify(display_name.trim())}\n  order: ${order}\n---\n\n# ${display_name.trim()}\n\n## 风格与题材\n\n## 人物塑造\n\n## 声音与对白\n\n## 禁忌\n`
    if (suppliedContent !== undefined) {
      const parsed = parseSkill(suppliedContent)
      if (parsed.metadata?.kind !== 'director') throw invalid('导演 Skill 的 metadata.kind 必须为 director')
      if (typeof parsed.metadata.display_name !== 'string' || !Number.isInteger(parsed.metadata.order)) throw invalid('导演 Skill 缺少 display_name 或 order')
      const end = suppliedContent.indexOf('\n---\n', 4)
      const header = suppliedContent.slice(0, end)
      if (!/^name: [^\n]+$/m.test(header) || !/^  display_name: [^\n]+$/m.test(header) || !/^  order: [^\n]+$/m.test(header)) throw invalid('导演 Skill 缺少 name、display_name 或 order')
      content = header.replace(/^name: [^\n]+$/m, `name: ${name}`)
        .replace(/^  display_name: [^\n]+$/m, `  display_name: ${JSON.stringify(display_name.trim())}`)
        .replace(/^  order: [^\n]+$/m, `  order: ${order}`) + suppliedContent.slice(end)
    }
    await skills.save(name, content)
    await skills.saveReference(name, 'series.md', seriesTemplate)
    await skills.saveReference(name, 'script.md', scriptTemplate)
    await skills.saveReference(name, 'storyboard.md', storyboardTemplate)
    return get(name)
  }
  const reorder = async names => {
    const items = await list()
    if (!Array.isArray(names) || names.length !== items.length || new Set(names).size !== items.length || names.some(name => !items.some(item => item.name === name))) throw invalid('导演排序无效')
    for (const [order, name] of names.entries()) {
      const item = await get(name)
      const content = item.content.replace(/(^metadata:\n(?:  .*\n)*?  order: )[^\n]*/m, `$1${order}`)
      if (content === item.content && item.order !== order) throw invalid('导演 Skill 缺少 metadata.order')
      if (item.order !== order) await save({ name, file: 'SKILL.md', content })
    }
    return list()
  }
  const remove = async (name, inUse = async () => false) => {
    await get(name)
    if (await inUse(name)) throw invalid('该导演已被项目使用，不能删除')
    return skills.remove(name)
  }
  return { list, has, get, save, create, reorder, remove }
}
