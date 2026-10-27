import { readdir, readFile } from 'node:fs/promises'
import { nodeDefinitions } from './node_definition_registry.js'

/** 只索引盒子内的具名skill；模型看到元数据，正文由读取工具返回。 */
export async function boxSkills(nodeType, action, rules) {
  if (!(Object.hasOwn(nodeDefinitions, nodeType) && nodeType !== '$defs') && nodeType !== 'project') throw new TypeError('未知盒子')
  const directory = new URL(`../node_box/${nodeType}/skills/`, import.meta.url)
  const skills = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9-]+$/u.test(entry.name)) continue
    const file = new URL(`${entry.name}/SKILL.md`, directory), source = await readFile(file, 'utf8')
    const header = source.match(/^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n/u)
    if (!header || header[1] !== entry.name) throw new TypeError(`skill元数据无效：${entry.name}`)
    const actions = { generate: '生成', revise: '修订', review: '审核' }
    const applicable = [...source.matchAll(/适用动作：([^\n]+)。/gu)].map(match => match[1]).join('、')
    if (applicable && !applicable.includes(actions[action])) continue
    const rawDescription = header[2], description = rawDescription.startsWith('"') ? JSON.parse(rawDescription) : rawDescription
    skills.push({ name: entry.name, description, read: async () => source.slice(header[0].length).trim() })
  }
  // 原项目的定制规则优先；默认base已拆为本地skill，不再重复注入整份默认规则。
  const selected = rules?.rules?.[action]
  if (selected) {
    const defaults = JSON.parse(await readFile(new URL(`../../skills/${nodeType}.json`, import.meta.url), 'utf8'))
    if (selected.base !== defaults.rules[action].base) skills.push({ name: 'project-base', description: '本项目已保存的当前动作基础规则；有定制时必须读取，优先于默认skill。', required: true, read: async () => selected.base })
    if (rules.supports_supplement && selected.supplement?.trim()) skills.push({ name: 'project-supplement', description: '本项目当前动作的补充规则；必须读取。', required: true, read: async () => selected.supplement })
  }
  return skills
}
