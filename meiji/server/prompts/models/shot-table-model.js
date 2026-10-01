// shots 接口：在此独立定义生成、审核、修订的角色、顺序与输出格式。
// 下列片段均为显式选择；可删减、移动到另一角色，或替换为本接口自己的 segment。
import { currentSkillSet, generationParts, reviewParts, segment } from '../skill-prompts.js'
import { withRequirements, revisionTask } from '../interfaces/text-context.js'

function compose(task, kind) {
  const p = generationParts({ ...task, stage: 'shots', kind, outputProtocol: '从第一个镜头标题开始返回完整镜头表正文，禁止 JSON 包装。' })
  return {
    json: false,
    system: [
      segment('context', '【角色与职责】', '你是一名短剧镜头规划师。完成本次指定任务，遵守上游事实和基础生产规则。'), p.common, ...p.commonShared, p.generate,
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
  const p = reviewParts({ ...withRequirements(task), stage: 'shots' }, content)
  return {
    json: false,
    system: [segment('context', '【角色与职责】', '你是一名独立短剧镜头规划师审核员，只验收最新待审内容，不生成或修改原文。'), p.commonProtocol, ...p.shared, ...p.assetRules, p.language, p.protocol],
    user: [p.stage, p.context,
      segment('context', '【修订基稿（用于对照范围）】', task.baseContent),
      p.opinion, p.criteria, ...p.guidance, ...p.additions,
      ...p.assetContent, p.continuity, p.content, p.scope],
  }
}

function revise(task, content, review) {
  return compose(revisionTask(withRequirements(task), content, review), 'revise')
}

export class ShotTableModel {
  constructor(task = {}) {
    this.task = { ...task, project: structuredClone(task.project || {}), skillSet: structuredClone(currentSkillSet(task.project, task.skillSet)) }
    this.generationRules = task.generationRules ?? this.task.skillSet.skills['shots'].constraints
  }
  requestTask() { this.task.skillSet.skills['shots'].constraints = this.generationRules; return this.task }
  toGenerateSegments() { return generate(this.requestTask()) }
  toReviewSegments(content) { return review(this.requestTask(), content) }
  toReviseSegments(content, opinion) { return revise(this.requestTask(), content, opinion) }
}
