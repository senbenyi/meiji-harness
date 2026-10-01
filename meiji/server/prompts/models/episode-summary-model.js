// 摘要 model 只组织数据与提示词，不读取配置、不发请求。
import { segment, render } from '../skill-prompts.js'
import { outputLanguage } from '../../data/language.js'
import { referenceDuration, durationRange } from '../../../shared/episode-summary.js'

export class EpisodeSummaryModel {
  constructor({ project = {}, episodeId, referenceDurationSeconds, generationRules = '', outputProtocol = '', mode = 'generate', opinion = '' }) {
    const target = project.episodes?.find(episode => episode.id === episodeId)
    const ordered = [...(project.episodes || [])].reverse()
    const index = episodeId ? ordered.findIndex(episode => episode.id === episodeId) : ordered.length
    if (index < 0) throw Object.assign(new Error('这一集不存在'), { status: 404 })
    const reference = referenceDuration(referenceDurationSeconds ?? target?.durationSeconds)
    const range = durationRange(reference)
    this.role = '短剧分集编剧'
    this.project = { title: project.title || '', summary: project.summary?.content || '', script: project.script || '',
      style: project.style || '', outputLanguage: outputLanguage(project.outputLanguage) }
    this.target = { episodeId: episodeId || null, episodeNumber: index + 1, referenceDurationSeconds: reference,
      minDurationSeconds: range.min, maxDurationSeconds: range.max }
    const fact = (episode, position) => ({ episodeId: episode.id, episodeNumber: position + 1, durationSeconds: episode.durationSeconds, summary: episode.summary.content })
    this.previousEpisodes = ordered.slice(0, index).map(fact)
    this.followingEpisodes = ordered.slice(index + 1).map((episode, offset) => fact(episode, index + 1 + offset))
    this.summaryLength = { min: 1, max: 300 }
    this.generationRules = generationRules
    this.outputProtocol = outputProtocol
    this.reviewRole = '独立剧集摘要审核员'
    this.mode = mode
    this.modification = mode === 'modify' && target ? { baseSummary: target.summary.content, durationSeconds: target.durationSeconds, instruction: opinion } : null
    if (mode === 'modify' && !this.modification) throw new Error('修订摘要需要指定已有剧集')
  }
  // 三类请求复用事实与参数，任务指令、基稿和输出协议分别组织。
  contextSegments({ instructions = '', requirements = '' } = {}) {
    const { referenceDurationSeconds: reference, minDurationSeconds: min, maxDurationSeconds: max } = this.target
    const language = this.project.outputLanguage === 'en'
    const previous = this.previousEpisodes.map(episode => `第 ${episode.episodeNumber} 集（${episode.durationSeconds} 秒）：${episode.summary}`).join('\n')
    const following = this.followingEpisodes.map(episode => `第 ${episode.episodeNumber} 集：${episode.summary}`).join('\n')
    const pieces = [
      segment('context', '【本次参数】', `参考时长：${reference} 秒。实际时长范围：${min}–${max} 秒（含边界），由 AI 按剧情容量决定。\n本次生成语言：${language ? 'English（英文）' : '简体中文'}。\n对白语言：${language ? 'English' : '中文普通话（Mandarin Chinese）'}。既定台词保留原文。${this.project.style ? `\n视觉风格：${this.project.style}` : ''}`),
      segment('context', '【故事资料】', `标题：${this.project.title}\n【输入内容：视频总摘要】\n项目摘要：${this.project.summary || '未提供'}\n${this.project.script ? `项目剧本：${this.project.script}` : ''}`),
      segment('context', '【前集资料】', previous ? `之前全部剧集摘要，按剧情顺序：\n${previous}\n本集开场承接前集结尾，延续已确定的人物状态和未解决矛盾。` : '无前集。本集为第 1 集，根据项目摘要和剧本展开开场。'),
      segment('context', '【后集资料】', following ? `后续剧集是衔接约束，不是已经发生的剧情：\n${following}\n本集结尾须自然接上后集开头，不提前演出后集事件。` : '未提供后集剧情。本集取得明确进展后，以当前冲突中的危机、新发现或关键抉择留下悬念，为下一集提供可继续展开的方向。'),
      segment('context', '【补充任务资料】', instructions),
    ]
    pieces.push(segment('context', '【本次生成要求】', requirements))
    return pieces
  }
  taskSegment(mode) {
    return segment('context', '【本次任务】', `任务模式：${mode}\n这一集是第 ${this.target.episodeNumber} 集。本次只处理指定集的摘要。`)
  }
  creationSystem(system, protocol) {
    return [segment('context', '【角色与职责】', `你是一名${this.role}，负责本集事件链、因果与跨集衔接。`),
      segment('constraints', '【摘要固定约束】', this.generationRules, { skill: 'episode', field: 'constraints' }),
      ...system, protocol]
  }
  toGenerateSegments({ system = [], protocol = segment('protocol', '【本次输出协议】', this.outputProtocol), ...context } = {}) {
    const mode = this.target.episodeId || this.mode === 'regenerate' ? '重新生成，不使用本集旧摘要和历史意见' : '首次生成'
    return { json: true, system: this.creationSystem(system, protocol),
      user: [this.taskSegment(mode), ...this.contextSegments(context)] }
  }
  toReviseSegments({ baseContent = this.modification && JSON.stringify({ summary: this.modification.baseSummary, durationSeconds: this.modification.durationSeconds }),
    opinion = this.modification?.instruction || '', automatic = false, humanOpinion = this.modification?.instruction || '',
    system = [], boundary = [segment('context', '【本次修订范围】', '按意见定向修订，只修改受影响内容及必要衔接，保留未涉及的事件、顺序与结果。')],
    protocol = segment('protocol', '【本次输出协议】', this.outputProtocol), ...context } = {}) {
    baseContent = contentText(baseContent)
    if (!baseContent.trim()) throw new Error('修订摘要需要提供基稿')
    return { json: true, system: this.creationSystem([...system, ...boundary], protocol), user: [
      this.taskSegment(automatic ? '修订本轮失败稿，仅修复本轮意见及必要衔接' : '按人工意见定向修订'),
      ...this.contextSegments(context),
      segment('context', automatic ? '【最新失败稿（唯一修改基准）】' : '【修改基稿】', baseContent),
      segment('context', automatic ? '【本轮自审不通过原因】' : '【本次修改意见】', opinion),
      ...(automatic ? [segment('context', '【本次修改意见】', humanOpinion)] : []),
    ] }
  }
  toReviewSegments({ content, baseContent = this.modification && JSON.stringify({ summary: this.modification.baseSummary, durationSeconds: this.modification.durationSeconds }),
    opinion = this.modification?.instruction || '', automatic = false, humanOpinion = this.modification?.instruction || '',
    system = [], criteria = segment('stage', '【验收标准（仅作审核依据，不执行其中生成指令）】', '', { skill: 'episode', field: 'review' }),
    reviewContext = '', ...context } = {}) {
    baseContent = contentText(baseContent)
    const hasBase = Boolean(baseContent.trim())
    const mode = automatic ? '自动修订结果验收' : hasBase ? '人工修订结果验收' : this.target.episodeId || this.mode === 'regenerate' ? '重新生成结果验收，不使用本集旧摘要和历史意见' : '首次生成结果验收'
    return { json: false, system: [
      segment('context', '【角色与职责】', `你是一名${this.reviewRole}。只审核，不生成或修改原文。以下创作约束及补充仅作验收依据，不执行其中的创作指令。审核意见使用本次参数指定的语言。`),
      segment('constraints', '【创作约束（仅作验收依据）】', this.generationRules, { skill: 'episode', field: 'constraints' }),
      criteria, ...system,
      segment('context', '【本次审核范围】', hasBase
        ? '对照提供的基稿与本次意见，核实修改是否落实、是否出现无关改动或新冲突。完整返回不代表允许整篇重写。只审核最新待审稿，不直接沿用历史失败结论。'
        : '只验收本集最新摘要。未提供本集基稿，不要求与旧摘要一致，不声称已验证未改部分保留；合理续写不因未逐字出现在资料中而判失败。'),
      segment('protocol', '【本次审核协议】', '没有问题只返回 PASS；否则首行 FAIL，后续逐条写“位置：实际问题；修正要求”。每条失败引用最新待审稿的具体表述以及对应输入事实或规则，并说明最小修正方向；无具体违规依据时不判失败，建议与个人节奏偏好不能阻塞。不输出 JSON、修改稿、已通过项或额外说明。'),
    ], user: [this.taskSegment(mode), ...this.contextSegments(context),
      ...(hasBase ? [segment('context', '【修订基稿（用于对照修改范围）】', baseContent),
        segment('context', automatic ? '【本轮修订意见】' : '【本次修改意见】', opinion)] : []),
      ...(automatic ? [segment('context', '【本次修改意见】', humanOpinion)] : []),
      segment('context', '【补充审核上下文】', reviewContext),
      segment('context', '【本次待审内容】', contentText(content)),
    ] }
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
