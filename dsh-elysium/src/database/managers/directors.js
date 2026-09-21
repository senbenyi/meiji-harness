// 职责：以标准 Skill 为导演的唯一存储形式，提供列表、全文编辑和排序。
import { randomBytes } from 'node:crypto'
import { createSkillsStore, parseSkill } from './skills.js'
import { flowSteps } from './flow.js'
import { statusError } from '../../utils/errors.js'

const invalid = message => statusError(400, message)
const files = ['SKILL.md', ...flowSteps.map(step => `${step}.md`)]
// 新建导演的标准结构，与 docs/design/规范-Skill编写.md 第 3 节一致；括号内是填写说明。
const skillBody = title => `# ${title}\n\n## 风格与题材\n\n（核心情绪体验、世界观质感、整体基调）\n\n## 人物塑造\n\n（主角、对手、配角的性格与表现方式）\n\n## 声音与对白\n\n（对白长短、音色、环境音；对白写法示例）\n\n## 禁忌\n\n（内容安全与价值观底线）\n\n## 代表作参考（风格参照，不复制情节）\n`
const templates = {
  'project.md': '# 导演立项\n\n## 题材范围\n\n（允许的题材列表）\n\n## 立项要求\n\n（梗概写什么：主角处境、核心冲突、情绪卖点；不写分集）\n',
  'series.md': '# 导演总览\n\n## 规模\n\n- 集数：固定 2 集。\n- 单集时长：60–120 秒。\n\n## 分集结构\n\n（每集承担的剧情功能）\n\n## 角色设定\n\n（服装色系与标志物跨集不变；定妆画风）\n\n## 场景设定\n\n（场景数量与复用原则）\n',
  'script.md': '# 导演剧本\n\n## 单集结构\n\n（开头 / 中段 / 结尾各做什么）\n\n## 节奏\n\n（情绪起伏与交替方式）\n\n## 对白风格\n\n（句长、口语化程度、关键台词写法）\n\n## 物件与伏笔\n\n（承载情绪或反转的物件、跨集复现方式）\n',
  'storyboard.md': '# 导演分镜\n\n## 镜头语言\n\n（常用景别、构图、特写的使用场合）\n\n## 单镜时长\n\n（信息镜头与情绪镜头的时长范围）\n\n## 光线与色调\n\n（不同情绪段的光线与色温）\n\n## 视频描述要求\n\n（视频描述必须写清的风格要素）\n',
}
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
    let content = `---\nname: ${name}\ndescription: ${JSON.stringify(description?.trim() || display_name.trim() + '的导演风格')}\nmetadata:\n  kind: director\n  display_name: ${JSON.stringify(display_name.trim())}\n  order: ${order}\n---\n\n${skillBody(display_name.trim())}`
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
    for (const [file, template] of Object.entries(templates)) await skills.saveReference(name, file, template)
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
