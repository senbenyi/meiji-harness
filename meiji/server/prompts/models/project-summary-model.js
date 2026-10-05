import { segment, render } from '../skill-prompts.js'
import { generationRequest, reviewRequest, baseSegments } from '../prompt-request.js'
import { reviewProtocol } from '../../../shared/review-result.js'
import { outputLanguage } from '../../../shared/output-language.js'

const languageBlock = language => `输出语言：${outputLanguage(language) === 'en' ? 'English（英文）' : '简体中文'}`

// 项目摘要只提取完整剧本；不负责分集和生成新事件。
export class ProjectSummaryModel {
  constructor({ project, generationRules = '', reviewRules = '', outputProtocol = '' }) {
    this.project = project
    this.generationRules = generationRules
    this.reviewRules = reviewRules
    this.outputProtocol = outputProtocol
  }
  facts() { return [segment('context', '【剧本】', this.project.script), segment('context', '【故事基调】', this.project.premise)] }
  toGenerateSegments(parts = {}) { return this.creation('generate', '从当前剧本加故事基调生成全剧概要的项目摘要，遵守基础规则和补充规则。', parts) }
  toReviseSegments(parts = {}) { return this.creation('revise', '依据当前剧本、故事基调和本轮意见修订项目摘要，遵守基础规则和补充规则。', parts) }
  creation(kind, task, { baseContent = '', opinion = '', ...parts }) {
    return generationRequest({ json: true,
      role: segment('context', '【角色与职责】', '你是一名剧本编辑。'),
      rules: segment('stage', '【基础规则】', this.generationRules, { skill: 'project-summary', field: 'constraints' }),
      ...parts, language: parts.language || segment('language', '', languageBlock(this.project.outputLanguage)),
      protocol: parts.protocol || segment('protocol', '【本次输出协议】', this.outputProtocol),
      task: segment('context', '【本次任务】', task), facts: this.facts(),
      base: baseSegments({ kind, baseContent, opinion, automatic: true, field: 'summary' }),
    })
  }
  toReviewSegments({ content, baseContent, opinion, automatic, ...parts }) {
    return reviewRequest({
      role: segment('context', '【角色与职责】', '你是一名独立剧本摘要审核员。'),
      criteria: segment('stage', '【审核标准】', this.reviewRules, { skill: 'project-summary', field: 'review' }),
      ...parts, language: parts.language || segment('language', '', languageBlock(this.project.outputLanguage)),
      protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      task: segment('context', '【本次任务】', '依据剧本审核最新项目摘要。'), facts: this.facts(),
      base: baseContent ? baseSegments({ kind: 'review', baseContent, opinion, automatic, field: 'summary' }) : [],
      content: segment('context', '【本次待审内容】', content),
    })
  }
  toGenerateMessages(parts) { return messages(this.toGenerateSegments(parts)) }
  toReviseMessages(parts) { return messages(this.toReviseSegments(parts)) }
  toReviewMessages(parts) { return messages(this.toReviewSegments(parts)) }
}

const messages = ({ system, user }) => [{ role: 'system', content: render(system) }, { role: 'user', content: render(user) }]
