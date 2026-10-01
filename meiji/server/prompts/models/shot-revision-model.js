// shot-revise 接口：在此独立定义生成、审核、修订的角色、顺序与输出格式。
// 下列片段均为显式选择；可删减、移动到另一角色，或替换为本接口自己的 segment。
import { currentSkillSet, generationParts, reviewParts, segment } from '../skill-prompts.js'
import { withRequirements, revisionTask } from '../interfaces/text-context.js'

const scope = () => segment('context', '【单镜任务范围】', '只处理本次指定镜头，沿用已保存的编号和时长；未要求改动的剧情事实保持不变，核对前后镜状态、身体身份与空间关系。若需调整跨段边界或其他镜头，指出具体缺口，由镜头表任务重新规划，不在本次修改其他镜头，不将全表问题声称为已经全部修复。')

function compose(task, kind) {
  const p = generationParts({ ...task, stage: 'shot-revise', kind, outputProtocol: '仅返回目标镜头完整正文，保留该镜编号和时长，禁止 JSON 包装。' })
  return {
    json: false,
    system: [
      segment('context', '【角色与职责】', '你是一名单镜剧情修订师。完成本次指定任务，遵守上游事实和基础生产规则。'), scope(), p.common, ...p.commonShared, p.generate,
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
  const p = reviewParts({ ...withRequirements(task), stage: 'shot-revise' }, content)
  return {
    json: true,
    system: [segment('context', '【角色与职责】', '你是一名独立单镜剧情修订师审核员，只验收最新待审内容，不生成或修改原文。'), scope(), p.commonProtocol, ...p.shared, ...p.assetRules, p.language, p.protocol],
    user: [p.stage, p.context,
      segment('context', '【修订基稿（用于对照范围）】', task.baseContent),
      p.opinion, p.criteria, ...p.guidance, ...p.additions,
      ...p.assetContent, p.continuity, p.content, p.scope],
  }
}

function revise(task, content, review) {
  return compose(revisionTask(withRequirements(task), content, review), 'revise')
}

export class ShotRevisionModel {
  constructor(task = {}) {
    this.task = { ...task, project: structuredClone(task.project || {}), skillSet: structuredClone(currentSkillSet(task.project, task.skillSet)) }
    this.generationRules = task.generationRules ?? this.task.skillSet.skills['shot-revise'].constraints
  }
  requestTask() { this.task.skillSet.skills['shot-revise'].constraints = this.generationRules; return this.task }
  toGenerateSegments() { return generate(this.requestTask()) }
  toReviewSegments(content) { return review(this.requestTask(), content) }
  toReviseSegments(content, opinion) { return revise(this.requestTask(), content, opinion) }
}
