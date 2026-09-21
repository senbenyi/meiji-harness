// 职责：读写流程 Skill（drama）的总纲与各步骤说明，只允许固定文件，供工作台全文编辑。
import { createSkillsStore } from './skills.js'
import { readFile, writeFile, rename, rm } from '../files.js'
import { skillsRoot } from '../paths.js'
import { statusError } from '../../utils/errors.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const FLOW_SKILL = 'drama'
export const flowSteps = ['project', 'series', 'script', 'storyboard']
const files = ['SKILL.md', ...flowSteps.map(step => `steps/${step}.md`)]

export function createFlowSkillStore() {
  const skills = createSkillsStore()
  const path = file => join(skillsRoot(), FLOW_SKILL, file)
  const optional = file => readFile(path(file), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  const get = async () => {
    const values = await Promise.all(files.slice(1).map(optional))
    return { name: FLOW_SKILL, files: Object.fromEntries([['SKILL.md', (await skills.get(FLOW_SKILL)).content], ...files.slice(1).map((file, index) => [file, values[index]])]) }
  }
  const save = async ({ file, content }) => {
    if (!files.includes(file) || typeof content !== 'string') throw statusError(400, '流程 Skill 文件无效')
    if (file === 'SKILL.md') await skills.save(FLOW_SKILL, content)
    else {
      const target = path(file), temporary = `${target}.${randomUUID()}.tmp`
      try { await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, target) }
      finally { await rm(temporary, { force: true }) }
    }
    return get()
  }
  return { get, save }
}
