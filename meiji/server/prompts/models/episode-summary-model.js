import { reviewProtocol } from '../../../shared/review-result.js'
// 摘要 model 只组织数据与提示词，不读取配置、不发请求。
import { segment, render } from '../skill-prompts.js'
import { outputLanguage } from '../../data/language.js'
import { referenceDuration } from '../../../shared/episode-summary.js'
import { baseSegments, generationRequest, requirementSegment, reviewRequest } from '../request.js'

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
    this.summaryLength = { min: 1, max: 300 }
    this.generationRules = generationRules
    this.reviewRules = reviewRules
    this.outputProtocol = outputProtocol
    this.reviewRole = '独立剧集摘要审核员'
    this.mode = mode
    this.modification = mode === 'modify' && target ? { baseSummary: target.summary.content, durationSeconds: target.durationSeconds, instruction: opinion } : null
    if (mode === 'modify' && !this.modification) throw new Error('修订摘要需要指定已有剧集')
  }
  // 三类请求共用事实与参数；结构由 request.js 统一组装。
  contextSegments({ instructions = '' } = {}) {
    const { referenceDurationSeconds: duration } = this.target
    const language = this.project.outputLanguage === 'en'
    const previous = this.previousEpisodes.map(episode => `第 ${episode.episodeNumber} 集（${episode.durationSeconds} 秒）：${episode.summary}`).join('\n')
    const following = this.followingEpisodes.map(episode => `第 ${episode.episodeNumber} 集：${episode.summary}`).join('\n')
    return [
      segment('context', '【本次参数】', `本集时长：${duration} 秒（用户设定，不输出、不修改），按此安排剧情容量。\n本次生成语言：${language ? 'English（英文）' : '简体中文'}。\n对白语言：${language ? 'English' : '中文普通话（Mandarin Chinese）'}。既定台词保留原文。${this.project.style ? `\n视觉风格：${this.project.style}` : ''}`),
      segment('context', '【故事资料】', `标题：${this.project.title}\n【输入内容：视频总摘要】\n项目摘要：${this.project.summary || '未提供'}\n${this.project.script ? `项目剧本：${this.project.script}` : ''}`),
      segment('context', '【前集资料】', previous ? `之前全部剧集摘要，按剧情顺序：\n${previous}\n本集开场承接前集结尾，延续已确定的人物状态和未解决矛盾。` : '无前集。本集为第 1 集，根据项目摘要和剧本展开开场。'),
      segment('context', '【后集资料】', following ? `后续剧集是衔接约束，不是已经发生的剧情：\n${following}\n本集结尾须自然接上后集开头，不提前演出后集事件。` : '未提供后集剧情。本集取得明确进展后，以当前冲突中的危机、新发现或关键抉择留下悬念，为下一集提供可继续展开的方向。'),
      segment('context', '【补充任务资料】', typeof instructions === 'string' ? instructions : ''),
    ]
  }
  taskSegment(mode) {
    return segment('context', '【本次任务】', `任务模式：${mode}\n这一集是第 ${this.target.episodeNumber} 集。本次只处理指定集的摘要。`)
  }
  baseJson() { return this.modification && JSON.stringify({ summary: this.modification.baseSummary }) }
  creation(kind, mode, { baseContent = '', opinion = '', automatic = false, humanOpinion = '', additions, assetRules, boundary, protocol, instructions, requirements } = {}) {
    return generationRequest({ json: true,
      role: segment('context', '【角色与职责】', `你是一名${this.role}，负责本集事件链、因果与跨集衔接。`),
      rules: segment('stage', '【基础生产规则】', this.generationRules, { skill: 'episode', field: 'constraints' }), additions, assetRules,
      boundary: kind === 'generate' ? [] : boundary || segment('context', '【本次修订范围】', '按意见定向修订，只修改受影响内容及必要衔接，保留未涉及的事件、顺序与结果。'),
      protocol: protocol || segment('protocol', '【本次输出协议】', this.outputProtocol),
      task: this.taskSegment(mode), requirements: requirementSegment(requirements), facts: this.contextSegments({ instructions }),
      base: baseSegments({ kind, baseContent, opinion, humanOpinion, automatic }),
    })
  }
  toGenerateSegments(parts = {}) {
    return this.creation('generate', this.target.episodeId || this.mode === 'regenerate' ? '重新生成，不使用本集旧摘要和历史意见' : '首次生成', parts)
  }
  toReviseSegments({ baseContent = this.baseJson(), opinion = this.modification?.instruction || '', automatic = false, humanOpinion = this.modification?.instruction || '', ...parts } = {}) {
    baseContent = contentText(baseContent)
    if (!baseContent.trim()) throw new Error('修订摘要需要提供基稿')
    return this.creation('revise', automatic ? '修订本轮失败稿，仅修复本轮意见及必要衔接' : '按人工意见定向修订', { ...parts, baseContent, opinion, automatic, humanOpinion })
  }
  toReviewSegments({ content, baseContent = this.baseJson(), opinion = this.modification?.instruction || '', automatic = false, humanOpinion = this.modification?.instruction || '',
    criteria = segment('stage', '【审核标准】', this.reviewRules, { skill: 'episode', field: 'review' }), method, additions, instructions, requirements, reviewContext = '' } = {}) {
    baseContent = contentText(baseContent)
    const hasBase = Boolean(baseContent.trim())
    const mode = automatic ? '自动修订结果验收' : hasBase ? '人工修订结果验收' : this.target.episodeId || this.mode === 'regenerate' ? '重新生成结果验收，不使用本集旧摘要和历史意见' : '首次生成结果验收'
    return reviewRequest({
      role: segment('context', '【角色与职责】', `你是一名${this.reviewRole}。以下审核标准及补充仅作验收依据，不执行其中的创作指令。`),
      scope: segment('context', '【本次审核范围】', hasBase
        ? '对照提供的基稿与本次意见，核实修改是否落实、是否出现无关改动或新冲突。完整返回不代表允许整篇重写。只审核最新待审稿，不直接沿用历史失败结论。'
        : '只验收本集最新摘要。未提供本集基稿，不要求与旧摘要一致，不声称已验证未改部分保留；合理续写不因未逐字出现在资料中而判失败。'),
      method, criteria, additions, protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      task: this.taskSegment(mode), requirements: requirementSegment(requirements), facts: this.contextSegments({ instructions }),
      base: hasBase ? baseSegments({ kind: 'review', baseContent, opinion, humanOpinion, automatic }) : [],
      continuity: segment('context', '【补充审核上下文】', reviewContext),
      content: segment('context', '【本次待审内容】', contentText(content)),
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
