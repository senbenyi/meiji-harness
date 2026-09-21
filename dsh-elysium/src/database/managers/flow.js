// 职责：读写流程 Skill（drama）的总纲与各步骤说明，只允许固定文件，供工作台全文编辑。
import { createSkillsStore } from './skills.js'
import { statusError } from '../../utils/errors.js'

export const FLOW_SKILL = 'drama'
export const flowSteps = ['project', 'series', 'script', 'storyboard']
const files = ['SKILL.md', ...flowSteps.map(step => `steps/${step}.md`)]

export function createFlowSkillStore() {
  const skills = createSkillsStore()
  const optional = file => skills.reference(FLOW_SKILL, file).catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  const get = async () => {
    const values = await Promise.all(files.slice(1).map(optional))
    return { name: FLOW_SKILL, files: Object.fromEntries([['SKILL.md', (await skills.get(FLOW_SKILL)).content], ...files.slice(1).map((file, index) => [file, values[index]])]) }
  }
  const save = async ({ file, content }) => {
    if (!files.includes(file) || typeof content !== 'string') throw statusError(400, '流程 Skill 文件无效')
    if (file === 'SKILL.md') await skills.save(FLOW_SKILL, content)
    else await skills.saveReference(FLOW_SKILL, file, content)
    return get()
  }
  return { get, save }
}
