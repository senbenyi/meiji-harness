// image-prompt 接口：在此独立定义生成、审核、修订的角色、顺序与输出格式。
// 下列片段均为显式选择；可删减、移动到另一角色，或替换为本接口自己的 segment。
import { currentSkillSet, generationParts, reviewParts, segment } from '../skill-prompts.js'
import { withRequirements, revisionTask } from '../interfaces/text-context.js'

const modificationRules = '保持同一个人物或场景，只修改用户指定的外观；其他身份、地标和画面事实不变。\n\n描述须足够具体供生图使用，不编造素材 ID 或文件地址。'

function compose(task, kind) {
  const p = generationParts({ ...task, stage: 'image-prompt', kind, outputProtocol: '只返回本阶段要求的正文。' })
  return {
    json: false,
    system: [
      segment('context', '【角色与职责】', '你是一名图片提示词设计师。完成本次指定任务，遵守上游事实和基础生产规则。'), p.common, ...p.commonShared, p.generate,
      ...p.guidance, ...p.additions, ...p.assetRules,
      ...(kind === 'revise' ? p.revisionBoundary : p.selfCheck),
      ...(kind === 'modify' ? p.revisionBoundary : []),
      p.language, p.priority, p.protocol,
    ],
    user: [p.context, ...p.assetContent,
      segment('context', task.automatic ? '【最新失败稿（唯一修改基准）】' : '【修改基稿】', kind !== 'generate' ? task.baseContent : ''),
      p.opinion, ...(task.automatic ? [segment('context', '【原人工意见】', task.humanOpinion)] : [])],
  }
}

function generate(task) {
  return compose(withRequirements(task), task.modify ? 'modify' : 'generate')
}

function review(task, content) {
  const p = reviewParts({ ...withRequirements(task), stage: 'image-prompt' }, content)
  return {
    json: true,
    system: [segment('context', '【角色与职责】', '你是一名独立图片提示词设计师审核员，只验收最新待审内容，不生成或修改原文。'), p.commonProtocol, ...p.shared, ...p.assetRules, p.language, p.protocol],
    user: [p.stage, p.context,
      segment('context', '【修订基稿（用于对照范围）】', task.baseContent),
      p.opinion, p.criteria, ...p.guidance, ...p.additions,
      ...p.assetContent, p.continuity, p.content, p.scope],
  }
}

function revise(task, content, review) {
  return compose(revisionTask(withRequirements(task), content, review), 'revise')
}

export class ImagePromptModel {
  constructor(task = {}) {
    this.task = { ...task, project: structuredClone(task.project || {}), skillSet: structuredClone(currentSkillSet(task.project, task.skillSet)) }
    this.generationRules = task.generationRules ?? modificationRules
  }
  requestTask() { this.task.skillSet.skills['image-prompt'].constraints = this.generationRules; return this.task }
  toGenerateSegments() { return generate(this.requestTask()) }
  toReviewSegments(content) { return review(this.requestTask(), content) }
  toReviseSegments(content, opinion) { return revise(this.requestTask(), content, opinion) }
}
