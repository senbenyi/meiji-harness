import { render } from './skill-prompts.js'
import { imageSegments } from './interfaces/prompt-interfaces.js'

export function propImagePrompt(item, project, instruction = '') {
  return imageSkillPrompt('part-image', { id: item.id, name: item.name, category: item.category, description: item.description, evidence: item.evidence }, project, { instruction })
}

// 图片接口只负责选取对应的独立组装模块；段落结构由该模块决定。
export function imageSkillPrompt(stage, prompt, project, options = {}) {
  return render(imageSegments({ ...options, stage, project, request: prompt }))
}
