// 场景图接口负责技能快照和 model 赋值，model 内部生成最终提示词。
import { aspectRatioOf } from '../../../shared/project-rules.js'
import { createSceneImageModel } from '../models/scene-image-model.js'
import { addition, currentSkillSet, recordUse } from '../skill-prompts.js'
import { builtinSkill } from '../../../skills/load-skills.js'

const stage = 'scene-image'

export function sceneImageModel(item, project, { mode = 'generate', images = [], canvas, instruction } = {}, skillSet) {
  const set = currentSkillSet(project, skillSet)
  recordUse(set, builtinSkill(stage), [])
  const [width, height] = aspectRatioOf(project?.aspectRatio).split('x').map(Number)
  return createSceneImageModel({
    scene: item, mode, images, canvas: canvas || { width, height },
    generationRules: set.skills[stage].constraints,
    additionalInstructions: addition(set, stage, 'generate'),
    modification: mode === 'modify' ? { instruction, preserveUnspecified: true } : null,
  })
}

export function sceneImageModificationModel(item, project, options, skillSet) {
  return sceneImageModel(item, project, { ...options, mode: 'modify' }, skillSet)
}

function generate({ item, project, request = '', skillSet, ...options }) {
  return sceneImageModel(item || { look: request }, project, options, skillSet).toSegments()
}

function modify({ item, project, skillSet, ...options }) {
  return sceneImageModificationModel(item, project, options, skillSet).toSegments()
}

function preview(args) {
  const item = args.project?.plot?.scenes?.items?.find(entry => entry.type === 'scene')
  return generate({ ...args, item, request: item ? '' : '（场景资料将在生成时由所选场景卡提取；当前仅预览技能模板）' })
}

export default { generate, modify, preview }

export function sceneImagePrompt(item, project, skillSet, options) {
  return sceneImageModel(item, project, options, skillSet).toPrompt()
}

export function sceneImageModificationPrompt(item, project, options, skillSet) {
  return sceneImageModificationModel(item, project, options, skillSet).toPrompt()
}
