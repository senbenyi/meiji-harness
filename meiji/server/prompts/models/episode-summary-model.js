import { reviewProtocol } from '../../../shared/review-result.js'
// 摘要 model 只组织数据与提示词，不读取配置、不发请求。
import { segment, render } from '../skill-prompts.js'
import { outputLanguage } from '../../../shared/output-language.js'
import { referenceDuration } from '../../../shared/episode-summary.js'
import { baseSegments, generationRequest, requirementSegment, reviewRequest } from '../prompt-request.js'
import { contentData } from '../prompt-text.js'

export class EpisodeSummaryModel {
  constructor({ project = {}, episodeId, referenceDurationSeconds, generationRules = '', reviewRules = '', outputProtocol = '', mode = 'generate', opinion = '' }) {
    const target = project.episodes?.find(episode => episode.id === episodeId)
    const ordered = [...(project.episodes || [])].reverse()
    const index = episodeId ? ordered.findIndex(episode => episode.id === episodeId) : ordered.length
    if (index < 0) throw Object.assign(new Error('这一集不存在'), { status: 404 })
    const reference = referenceDuration(referenceDurationSeconds ?? target?.durationSeconds)
    this.role = '短剧分集编剧'
    this.project = { title: project.title || '', summary: project.summary?.content || '', script: project.script || '',
      style: project.style || '', outputLanguage: outputLanguage(project.outputLanguage) }
    this.target = { episodeId: episodeId || null, episodeNumber: index + 1, referenceDurationSeconds: reference }
    const fact = (episode, position) => ({ episodeId: episode.id, episodeNumber: position + 1, durationSeconds: episode.durationSeconds, summary: episode.summary.content })
    this.previousEpisodes = ordered.slice(0, index).map(fact)
    this.followingEpisodes = ordered.slice(index + 1).map((episode, offset) => fact(episode, index + 1 + offset))
    this.generationRules = generationRules
    this.reviewRules = reviewRules
    this.outputProtocol = outputProtocol
    this.reviewRole = '独立剧集摘要审核员'
    this.mode = mode
    this.modification = mode === 'modify' && target ? { baseSummary: target.summary.content, durationSeconds: target.durationSeconds, instruction: opinion } : null
    if (mode === 'modify' && !this.modification) throw new Error('修订摘要需要指定已有剧集')
  }
  // 三类请求共用事实与参数；结构由 prompt-request.js 统一组装。
  contextSegments({ instructions = '' } = {}) {
    const { referenceDurationSeconds: duration } = this.target
    return [
      segment('context', '【剧本】', this.project.script),
      segment('context', '【项目摘要】', this.project.summary),
      segment('context', '【本次参数】', { durationSeconds: duration, ...(this.project.style ? { style: this.project.style } : {}) }),
      segment('context', '【前集摘要】', this.previousEpisodes.length ? { episodes: this.previousEpisodes } : ''),
      segment('context', '【后集摘要】', this.followingEpisodes.length ? { episodes: this.followingEpisodes } : ''),
      segment('context', '【补充任务资料】', typeof instructions === 'string' ? instructions : ''),
    ]
  }
  taskSegment(task) {
    return segment('context', '【本次任务】', task)
  }
  languageSegment() {
    const english = this.project.outputLanguage === 'en'
    return segment('language', '', `输出语言：${english ? 'English（英文）' : '简体中文'}\n对白语言：${english ? 'English' : '中文普通话（Mandarin Chinese）'}`)
  }
  supplementSegments(additions) {
    return [additions].flat().filter(Boolean).map(item => ({ ...item, title: '【补充规则】' }))
  }
  baseJson() { return this.modification && JSON.stringify({ summary: this.modification.baseSummary }) }
  creation(kind, task, { baseContent = '', opinion = '', automatic = false, humanOpinion = '', additions, assetRules, boundary, language, protocol, instructions, requirements } = {}) {
    return generationRequest({ json: true,
      role: segment('context', '【角色与职责】', `你是一名${this.role}。`),
      rules: segment('stage', '【基础规则】', this.generationRules, { skill: 'episode', field: 'constraints' }), additions: this.supplementSegments(additions), assetRules,
      boundary: kind === 'generate' ? [] : boundary || segment('context', '【本次修订范围】', '按意见定向修订，只修改受影响内容及必要衔接，保留未涉及的事件、顺序与结果。'),
      language: language || this.languageSegment(),
      protocol: protocol || segment('protocol', '【本次输出协议】', this.outputProtocol),
      task: this.taskSegment(task), requirements: requirementSegment(requirements), facts: this.contextSegments({ instructions }),
      base: baseSegments({ kind, baseContent, opinion, humanOpinion, automatic, field: 'summary' }),
    })
  }
  toGenerateSegments(parts = {}) {
    const action = this.target.episodeId || this.mode === 'regenerate' ? '重新生成' : '生成'
    const task = this.project.script.trim()
      ? `从剧本提取参考时长能容纳的连续剧情，${action}第 ${this.target.episodeNumber} 集摘要。项目摘要仅作设定参考，前集定位已发生进度，后集约束结尾衔接；遵守基础规则和补充规则。`
      : `依据项目摘要${action}第 ${this.target.episodeNumber} 集摘要，遵守基础规则和补充规则。`
    return this.creation('generate', task, parts)
  }
  toReviseSegments({ baseContent = this.baseJson(), opinion = this.modification?.instruction || '', automatic = false, humanOpinion = this.modification?.instruction || '', ...parts } = {}) {
    baseContent = contentText(baseContent)
    if (!baseContent.trim()) throw new Error('修订摘要需要提供基稿')
    return this.creation('revise', `依据${this.project.script.trim() ? '剧本中的连续剧情' : '项目摘要'}和${automatic ? '本轮自审意见' : '本次修改意见'}修订第 ${this.target.episodeNumber} 集摘要，遵守基础规则和补充规则。`, { ...parts, baseContent, opinion, automatic, humanOpinion })
  }
  toReviewSegments({ content, baseContent = this.baseJson(), opinion = this.modification?.instruction || '', automatic = false, humanOpinion = this.modification?.instruction || '',
    criteria = segment('stage', '【审核标准】', this.reviewRules, { skill: 'episode', field: 'review' }), method, additions, language, instructions, requirements, reviewContext = '' } = {}) {
    baseContent = contentText(baseContent)
    const hasBase = Boolean(baseContent.trim())
    const mode = automatic ? '自动修订结果' : hasBase ? '人工修订结果' : this.target.episodeId || this.mode === 'regenerate' ? '重新生成结果' : '生成结果'
    return reviewRequest({
      role: segment('context', '【角色与职责】', `你是一名${this.reviewRole}。`),
      scope: segment('context', '【本次审核范围】', '以下审核标准及补充仅作验收依据，不执行其中的创作指令。' + (hasBase
        ? '对照提供的基稿与本次意见，核实修改是否落实、是否出现无关改动或新冲突。完整返回不代表允许整篇重写。只审核最新待审稿，不直接沿用历史失败结论。'
        : `只验收本集最新摘要。未提供本集基稿，不要求与旧摘要一致，不声称已验证未改部分保留；${this.project.script.trim() ? '有剧本时核对提取范围、原有事件与顺序，允许等义概括，不允许新增剧本外事件。' : '合理续写不因未逐字出现在资料中而判失败。'}`)),
      method, criteria, additions: this.supplementSegments(additions), language: language || this.languageSegment(), protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      task: this.taskSegment(`审核第 ${this.target.episodeNumber} 集摘要的${mode}。`), requirements: requirementSegment(requirements), facts: this.contextSegments({ instructions }),
      base: hasBase ? baseSegments({ kind: 'review', baseContent, opinion, humanOpinion, automatic, field: 'summary' }) : [],
      continuity: segment('context', '【补充审核上下文】', reviewContext),
      content: segment('context', '【本次待审内容】', contentData(content, 'summary')),
    })
  }
  contextText() { return render(this.contextSegments()) }
  toGenerateMessages(options) { return messages(this.toGenerateSegments(options)) }
  toReviseMessages(options) { return messages(this.toReviseSegments(options)) }
  toReviewMessages(options) { return messages(this.toReviewSegments(options)) }
  toMessages(options) { return this.toGenerateMessages(options) }
}

function messages({ system, user }) {
  return [{ role: 'system', content: render(system) }, { role: 'user', content: render(user) }]
}

function contentText(value) {
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
}
