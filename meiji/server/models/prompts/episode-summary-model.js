// 摘要仅从本集故事小段提取，用于列表展示，不参与创作或拆镜。
import { reviewProtocol } from '../../../shared/review-result.js'
import { segment, render } from '../../prompts/skill-prompts.js'
import { outputLanguage } from '../../../shared/output-language.js'
import { generationRequest, reviewRequest, requirementSegment } from '../../prompts/prompt-request.js'
import { contentData } from '../../prompts/prompt-text.js'
import { outlineFailures } from '../../../shared/story-outline.js'

export class EpisodeSummaryModel {
  constructor({ project = {}, episodeId, generationRules = '', reviewRules = '', outputProtocol = '' }) {
    const target = project.episodes?.find(episode => episode.id === episodeId) || (project.plot ? project : null)
    if (!target || outlineFailures(target.plot?.outline?.content).length) throw Object.assign(new Error('请先生成本集故事小段，再提取展示摘要'), { status: 409 })
    this.project = project
    this.outline = target.plot.outline.content
    this.generationRules = generationRules
    this.reviewRules = reviewRules
    this.outputProtocol = outputProtocol
    this.role = '故事摘要提取员'
    this.reviewRole = '独立故事摘要核对员'
  }
  contextSegments() { return [segment('context', '【本集故事小段：摘要唯一来源】', this.outline)] }
  languageSegment() { return segment('language', '', `输出语言：${outputLanguage(this.project.outputLanguage) === 'en' ? 'English（英文）' : '简体中文'}`) }
  toGenerateSegments({ additions, protocol, language, requirements } = {}) {
    return generationRequest({ json: true,
      role: segment('context', '【角色与职责】', `你是一名${this.role}。`),
      rules: segment('stage', '【基础规则】', this.generationRules), additions: [additions].flat().filter(Boolean).map(item => ({ ...item, title: '【补充规则】' })),
      language: language || this.languageSegment(), protocol: protocol || segment('protocol', '【本次输出协议】', this.outputProtocol),
      task: segment('context', '【本次任务】', '从本集最新故事小段提取简洁展示摘要，仅概括已有剧情，不新增、修改或规划剧情。'),
      requirements: requirementSegment(requirements), facts: this.contextSegments(),
    })
  }
  toReviseSegments(parts = {}) { return this.toGenerateSegments(parts) }
  toReviewSegments({ content, criteria = segment('stage', '【审核标准】', this.reviewRules), method, language } = {}) {
    return reviewRequest({ role: segment('context', '【角色与职责】', `你是一名${this.reviewRole}。`), method, criteria,
      language: language || this.languageSegment(), protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      task: segment('context', '【本次任务】', '仅核对展示摘要是否忠实于故事小段，不要求摘要完整复述每个细节，不修改大纲。'),
      facts: this.contextSegments(), content: segment('context', '【本次待审内容】', contentData(content, 'summary')) })
  }
  contextText() { return render(this.contextSegments()) }
  toGenerateMessages(options) { return messages(this.toGenerateSegments(options)) }
  toReviseMessages(options) { return messages(this.toReviseSegments(options)) }
  toReviewMessages(options) { return messages(this.toReviewSegments(options)) }
  toMessages(options) { return this.toGenerateMessages(options) }
}
const messages = ({ system, user }) => [{ role: 'system', content: render(system) }, { role: 'user', content: render(user) }]
