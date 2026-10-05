import { creativeDirection } from '../../../shared/script-assembly.js'
import { segment } from '../skill-prompts.js'
import { baseSegments, generationRequest, reviewRequest, requirementSegment } from '../prompt-request.js'
import { reviewProtocol } from '../../../shared/review-result.js'

export class ScriptRevisionModel {
  constructor({ project, operation, facts, generationRules, reviewRules }) { Object.assign(this, { project, operation, facts, generationRules, reviewRules }) }
  context() {
    return [segment('context', '【当前剧本】', this.project.script), segment('context', '【AI 创作方向】', creativeDirection(this.project)), segment('context', '【剧本目标与回写事实】', this.facts)]
  }
  task() { return this.operation.action === 'script-sync' ? `以回写事实的 episodeId（${this.facts.episodeId || '删除目标'}）为本次目标，summaryAfter 为本集已发生事实；AI 创作方向只作背景，不可用它替代本集事实。核对摘要变化或删除事实，小范围整合剧本并修补衔接。分节剧本中本集没有小节时必须新增本集正文；已有内容无需改变时才说明无需修改。` : '按本次要求修改后续剧情，保持已发生剧情事实，生成小范围修改方案。' }
  creation(kind, parts = {}) {
    return generationRequest({ json: true, role: segment('context', '【角色与职责】', '你是一名剧本编辑，只提出可核对的修改方案。'), rules: segment('stage', '【基础规则】', this.generationRules), ...parts,
      task: segment('context', '【本次任务】', this.task()), requirements: requirementSegment(this.operation.requirements), facts: this.context(),
      base: baseSegments({ kind, baseContent: parts.baseContent, opinion: parts.opinion, field: 'script' }) })
  }
  generate(parts) { return this.creation('generate', parts) }
  revise(content, opinion, parts) { return this.creation('revise', { ...parts, baseContent: content, opinion }) }
  review(content, parts) {
    return reviewRequest({ role: segment('context', '【角色与职责】', '你是一名独立剧本修改审核员。'), ...parts, criteria: segment('stage', '【审核标准】', this.reviewRules), protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      task: segment('context', '【本次任务】', this.task()), requirements: requirementSegment(this.operation.requirements), facts: this.context(), content: segment('context', '【本次待审方案】', content) })
  }
}
