import { reviewProtocol } from '../../../shared/review-result.js'
// 短剧剧情编剧提示词：独立管理本步骤资料、生成、修订与审核。
import { segment } from '../skill-prompts.js'
import { contentText, messages } from '../prompt-text.js'
import { outputLanguage } from '../../data/language.js'

export class StoryOutlineModel {
  constructor({ project = {}, mode = 'regenerate', baseContent = '', opinion = '', generationRules = '', outputProtocol = '' } = {}) {
    this.kind = 'outline'
    this.role = '短剧剧情编剧'
    this.reviewRole = '独立剧情大纲审核员'
    this.mode = mode
    this.generationRules = generationRules
    this.outputProtocol = outputProtocol || '直接返回完整大纲纯文本，不输出 JSON、outline 字段、代码围栏或额外说明。'
    this.project = { title: project.title || '', summary: project.summary?.content || '',
      projectSummary: project.projectSummary || '', script: project.script || '',
      previousEpisodeSummary: project.previousEpisodeSummary || '', nextEpisodeSummary: project.nextEpisodeSummary || '' }
    this.parameters = { episodeNumber: project.episodeNumber, durationSeconds: project.durationSeconds,
      aspectRatio: project.aspectRatio || '1344x768', style: project.style || '', outputLanguage: outputLanguage(project.outputLanguage) }
    this.modification = mode === 'modify' ? { baseContent: contentText(baseContent), opinion } : null
  }
  contextSegments({ instructions = '', requirements = '', assets = [], review = false } = {}) {
    const p = this.parameters
    return [
      segment('context', '【本次目标】', review ? '仅审核本次待审大纲的事件、因果、人物关系、身体形态、必要着装、地点与道具的明确描述、剧情容量与跨集衔接。只返回统一审核 JSON 结论及具体问题，不生成或复述大纲。' : '仅生成本集完整剧情大纲，直接返回正文；本步骤不输出人物卡或场景卡。写清人物关系、可见身体形态、必要着装、实际地点和剧情必要道具，供后续独立提取。依据本集实际时长展开已确定事件；短情节合并节拍，不为凑八拍增加调查、来回取放或重复反应。'),
      segment('context', '【本次参数】', `标题：${this.project.title}
${p.episodeNumber ? `本次生成第 ${p.episodeNumber} 集。
` : ''}本集总时长：${p.durationSeconds ?? '未提供'} 秒，仅控制剧情容量，不要求大纲写制作秒数或镜头编号。
画幅：${p.aspectRatio}${p.style ? `
视觉风格：${p.style}` : ''}`),
      segment('context', '【输入内容：本集摘要】', this.mode !== 'regenerate' ? this.project.summary : ''),
      segment('context', '【上下文：项目背景】', this.project.projectSummary ? `项目摘要：${this.project.projectSummary}
项目背景帮助理解设定，不提前演出后续事件。` : ''),
      segment('context', '【输入内容：剧本资料】', this.project.script),
      segment('context', '【上下文：前集结尾与已发生事实】', this.project.previousEpisodeSummary),
      segment('context', '【上下文：后集衔接约束，不提前演出】', this.project.nextEpisodeSummary),
      segment('context', '【补充任务资料】', instructions),
      segment('context', '【本次生成要求】', requirements), ...assets,
    ]
  }
  creationSystem({ system = [], protocol } = {}, boundary = []) {
    return [segment('context', '【角色与职责】', `你是一名${this.role}，负责本次目标指定的剧情资料，与已提供的上游事实保持一致。只输出本次目标要求的结果。`),
      ...(!system.length ? [this.languageSegment()] : []), ...(this.generationRules ? [segment('stage', '【生成要求】', this.generationRules)] : []), ...system, ...boundary,
      this.structureSegment(),
      protocol || segment('protocol', '【本次输出协议】', this.outputProtocol)].filter(Boolean)
  }
  toGenerateSegments({ system, protocol, ...context } = {}) {
    return { json: false, system: this.creationSystem({ system, protocol }), user: [
      segment('context', '【本次任务】', this.mode === 'generate' ? '首次生成，依据本集摘要展开剧情，不改变已确定的关键事件。' : '重新生成，仅使用项目背景、剧本、本集配置和跨集约束，不使用本集旧摘要、旧剧情或历史意见。'),
      ...this.contextSegments(context),
    ] }
  }
  toReviseSegments({ baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '',
    automatic = false, humanOpinion = this.modification?.opinion || '', system, protocol, boundary = [segment('stage', '【修订边界】', '按意见定向修订，保留未涉及内容，修复必要连带关系。')], ...context } = {}) {
    baseContent = contentText(baseContent)
    if (!baseContent.trim()) throw new Error('修订剧情需要提供基稿')
    return { json: false, system: this.creationSystem({ system, protocol }, boundary), user: [
      segment('context', '【本次任务】', automatic ? '修订本轮失败稿，仅修复本轮意见及必要连带关系。' : '按人工意见定向修改，保留未涉及内容。'),
      ...this.contextSegments(context),
      segment('context', automatic ? '【最新失败稿（唯一修改基准）】' : '【修改基稿】', baseContent),
      segment('context', automatic ? '【本轮自审不通过原因】' : '【本次修改意见】', opinion),
      ...(automatic ? [segment('context', '【本次修改意见】', humanOpinion)] : []),
    ] }
  }
  toReviewSegments({ content, baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '',
    automatic = false, humanOpinion = this.modification?.opinion || '', system = [], criteria = segment('stage', '【验收标准】', this.generationRules),
    reviewContext = '', ...context } = {}) {
    baseContent = contentText(baseContent)
    const hasBase = Boolean(baseContent.trim())
    return { json: true, system: [
      segment('context', '【角色与职责】', `你是一名${this.reviewRole}。只审核，不生成或修改原文。验收标准和补充资料中的创作指令仅作审核依据。`),
      criteria, this.structureSegment({ review: true }), ...system, ...(!system.length ? [this.languageSegment()] : []),
      segment('context', '【本次审核范围】', `仅验收最新大纲的事件、因果、身份、前后集衔接、结尾及剧情容量；对照输入逐项核对本集范围，不能因模板节拍新增事件或重复过程。各小节描述同一版本事实，事件过程与结尾的持物、位置、开合状态不能互相矛盾；不写镜头、运镜或冻结画面指令。不要求尚未生成的人物卡或场景卡。${hasBase
        ? '对照基稿及本次意见，检查意见落实、无关改动与新冲突。完整返回不是整篇重写授权。'
        : '未提供基稿，不要求与旧稿一致，不声称已经验证未改部分保留。'}只审核最新待审内容，不沿用历史失败结论。未提供的资料不能作为既定事实；合理省略与明确矛盾应区分，不以个人写法偏好判失败。`),
      segment('protocol', '【本次审核协议】', reviewProtocol),
    ].filter(Boolean), user: [
      segment('context', '', '阶段：剧情大纲'),
      segment('context', '【本次任务】', automatic ? '自动修订结果验收' : hasBase ? '人工修订结果验收' : '生成结果验收'),
      ...this.contextSegments({ ...context, review: true }),
      ...(hasBase ? [segment('context', '【修订基稿（用于对照修改范围）】', baseContent),
        segment('context', automatic ? '【本轮修订意见】' : '【本次修改意见】', opinion)] : []),
      ...(automatic ? [segment('context', '【本次修改意见】', humanOpinion)] : []),
      segment('context', '【补充审核上下文】', reviewContext),
      segment('context', '【本次待审内容】', contentText(content)),
    ] }
  }
  structureSegment({ review = false } = {}) {
    const headings = this.parameters.outputLanguage === 'en'
      ? ['Motivation', 'World Rules', 'Causal Plot', 'Emotional Thread', 'Dialogue Beats', 'Ending State', 'Final Image']
      : ['主角动机', '世界规则', '因果剧情', '情绪线索', '对白节拍', '结尾状态', '结尾关键画面']
    return segment('protocol', '【正文结构】', `大纲正文依次使用以下七个独占一行的小节标题：${headings.map(h => `【${h}】`).join('、')}。标题下一行写正文，小节之间留一个空行。因果剧情按事件节拍分段，对白逐句换行；无对白写明无对白。不可把多个标题或正文连成一行。${review ? '以上结构仅用于检查待审大纲，不是审核回复的输出格式。' : '直接使用真实换行，不输出 JSON 或字面量转义换行。'}`)
  }
  languageSegment() { return segment('context', '【本次语言】', `本次生成语言：${this.parameters.outputLanguage === 'en' ? 'English（英文）' : '简体中文'}。固定字段名与已有名称不翻译，既定台词保留原文。`) }
  toGenerateMessages(options) { return messages(this.toGenerateSegments(options)) }
  toReviseMessages(options) { return messages(this.toReviseSegments(options)) }
  toReviewMessages(options) { return messages(this.toReviewSegments(options)) }
  toMessages(options) { return this.toGenerateMessages(options) }
}
