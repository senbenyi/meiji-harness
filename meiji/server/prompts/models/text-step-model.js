// 文本步骤的统一组装器：镜头表、单镜每秒指令、单镜修订、图片提示词改写共用同一套
// 生成 / 审核 / 修订编排（结构见 prompt-request.js），各步骤只在 textSteps 中声明差异；输出协议统一来自 skills/output-protocols.js。
import { currentSkillSet, generationParts, reviewParts, segment } from '../skill-prompts.js'
import { baseSegments, factSegments, generationRequest, requirementSegment, reviewRequest, taskInput } from '../prompt-request.js'
import { splitSecondsIssues } from '../seconds-feedback.js'
import { contentData } from '../prompt-text.js'

const secondsBoundary = '以同编号已通过镜头表的事件、剧情起止状态、实际身体身份和固定时长为上游事实；依据本镜关联资料设计具体机位、景别、剪辑与空间调度，保留上游明确的空间事实与摄影要求，大纲仅作整体参考。镜头表从叙事读取必要事实，不要求固定栏目；前镜交接摘要只用于核对切点末态和必要空间、声音连续性，不重演前镜过程，不复制前镜摄影安排；允许有依据的转场、时间省略和机位变化。程序问题、语义审核问题和人工意见用于修复当前基稿，不能修改上游事实或重排镜头事件。逐项核对意见与同编号镜头表，冲突时以镜头表为准，不采纳要求改写上游的替代方案。上游自身矛盾时不假定已经修正镜头表，不编造新事件掩盖矛盾。'
const secondsReviewMethod = '按 shotId 将最新待审镜头与同编号镜头表及本镜关联资料逐项对照。每项语义问题必须引用本次待审原文及对应上游事实或审核规则，不能把基稿、历史意见或其他镜头内容冒充该镜头依据；无法证实差异时不判失败。镜头表未规定的机位、景别、剪辑与具体调度由本阶段设计，不因上游缺少这些安排判失败。前镜交接摘要只核对必要状态与真实连续性，不要求前镜完整过程或摄影复制；不因镜头表缺少栏目、分段理由或未重复稳定状态判失败，允许有依据的转场、时间省略和机位变化。修正要求不得修改上游事件、剧情起止状态或把事件搬到别的镜头。上游自身矛盾时准确指出镜头表中的冲突来源，不声称待审稿遗漏了不存在的要求。只报告语义问题，不以“程序校验”命名问题；镜头 ID、毫秒时长、必填字段和实体标记由独立程序检查，不能因动作问题将正确时长判为“功能性时长偏差”。同一问题只列一次，不再以时长等名义重复列出。location 必须标明受影响镜头编号，跨镜问题列出相关编号。修订对照问题只用于核对最新稿，不直接复用旧失败结论。'

export const textSteps = {
  shots: { stage: 'shots', role: '短剧镜头规划师', reviewRole: '独立短剧镜头规划师审核员', json: true,
    reviewTask: '验收本集完整镜头表：剧情覆盖、完整台词、时长与编号及镜头之间的承接，不要求固定栏目或分段理由。',
    reviseTask: automatic => `依据大纲和${automatic ? '本轮自审意见' : '本次修改意见'}修订本集完整镜头表，遵守基础规则和补充规则。` },
  'shot-seconds': { stage: 'seconds', role: '单镜每秒指令编剧', reviewRole: '独立单镜每秒指令编剧审核员', json: true,
    reviewTask: '验收本镜每秒指令与已通过镜头表的一致性，以及与上一镜交接摘要的必要衔接。',
    reviseTask: automatic => `依据本镜镜头表和${automatic ? '本轮自审意见' : '本次修改意见'}修订本镜每秒指令，遵守基础规则和补充规则。` },
  'shot-revise': { stage: 'shot-revise', role: '单镜剧情修订师', reviewRole: '独立单镜剧情修订师审核员', json: true,
    scope: '只处理本次指定镜头，沿用已保存的编号和时长；未要求改动的剧情事实保持不变，核对前后镜状态、身体身份与空间关系。若需调整跨段边界或其他镜头，指出具体缺口，由镜头表任务重新规划，不在本次修改其他镜头，不将全表问题声称为已经全部修复。',
    reviewTask: '验收本次指定镜头的修订结果：意见落实、改动范围与前后镜衔接。' },
  // 图片提示词改写没有独立基础 skill 文件，生成规则在此定义；自审使用 review-image-prompt-skill.md。
  'image-prompt': { stage: 'image-prompt', role: '图片提示词设计师', reviewRole: '独立图片提示词设计师审核员', json: true,
    rules: '保持同一个人物或场景，只修改用户指定的外观；其他身份、地标和画面事实不变。\n\n描述须足够具体供生图使用，不编造素材 ID 或文件地址。',
    reviewTask: '验收改写后的图片提示词：主体保持、修改落实与可用性。' },
}

export class TextStepModel {
  constructor(kind, task = {}) {
    if (!textSteps[kind]) throw new Error(`未定义文本步骤：${kind}`)
    this.kind = kind
    this.config = textSteps[kind]
    this.task = { ...task, project: structuredClone(task.project || {}), skillSet: structuredClone(currentSkillSet(task.project, task.skillSet)) }
    this.input = taskInput(task.instructions)
    // 生成与修订使用的生产规则；可在构造后赋值替换。自审只使用审核 skill，不读取此属性。
    this.generationRules = task.generationRules ?? this.config.rules ?? this.task.skillSet.skills[this.config.stage].constraints
  }

  scope() { return segment('context', '【单镜任务范围】', this.config.scope || '') }

  base(kind, { baseContent = '', opinion = '', humanOpinion = '', automatic = false } = {}) {
    if (this.config.stage !== 'seconds') return baseSegments({ kind, baseContent, opinion, humanOpinion, automatic, field: this.config.stage === 'image-prompt' ? 'prompt' : 'shotTable' })
    const issues = automatic ? splitSecondsIssues(opinion) : this.task
    return [
      segment('context', kind === 'review' ? '【修订基稿（用于对照范围）】' : automatic ? '【最新失败稿（唯一修改基准）】' : '【修改基稿】', contentData(baseContent, 'seconds')),
      segment('context', '【程序校验问题】', issues.programIssues?.length ? { issues: issues.programIssues } : ''),
      segment('context', '【语义审核问题】', issues.semanticIssues?.length ? { issues: issues.semanticIssues } : ''),
      segment('context', '【人工修改意见】', automatic ? humanOpinion : opinion),
    ]
  }

  compose(kind, { baseContent = '', opinion = '', humanOpinion = '', automatic = false } = {}) {
    const { stage, role, json } = this.config
    const p = generationParts({ ...this.task, stage, kind, rules: this.generationRules })
    const seconds = stage === 'seconds'
    const output = seconds ? segment('protocol', '【本次输出范围】', `只返回 ${this.task.shotId || '当前指定镜头'} 的一个完整 shots 条目；生成、修改和自动修订均不得输出其他镜头。`) : null
    return generationRequest({ json,
      role: segment('context', '【角色与职责】', `你是一名${role}。`),
      scope: this.scope(), rules: { ...p.generate, title: '【基础规则】' }, additions: p.additions, assetRules: p.assetRules,
      boundary: [...(seconds ? [segment('context', '【上游与意见边界】', secondsBoundary)] : []), ...(kind === 'generate' ? [] : p.revisionBoundary)], language: p.language, protocol: [p.protocol, output],
      task: segment('context', '【本次任务】', kind !== 'generate' && this.config.reviseTask ? this.config.reviseTask(automatic) : this.input.task), requirements: requirementSegment(),
      facts: factSegments(this.input.facts), assets: p.assetContent,
      base: this.base(kind, { baseContent, opinion, humanOpinion, automatic }),
    })
  }

  toGenerateSegments() {
    return this.task.modify
      ? this.compose('modify', { baseContent: this.task.baseContent, opinion: this.task.opinion })
      : this.compose('generate', { opinion: this.task.opinion })
  }

  toReviewSegments(content) {
    const { task } = this
    const p = reviewParts({ ...task, stage: this.config.stage }, contentData(content, this.config.stage === 'seconds' ? 'seconds' : this.config.stage === 'image-prompt' ? 'prompt' : 'shotTable'))
    const method = this.config.stage === 'seconds' ? { ...p.method, text: `${p.method.text}\n\n${secondsReviewMethod}` } : p.method
    return reviewRequest({
      role: segment('context', '【角色与职责】', `你是一名${this.config.reviewRole}，验收最新待审内容。`),
      scope: this.scope(), method, criteria: p.criteria, additions: p.additions, assetRules: p.assetRules, language: p.language, protocol: p.protocol,
      stage: p.stage, task: segment('context', '【审核目标】', this.input.review || this.config.reviewTask), requirements: requirementSegment(),
      facts: factSegments(this.input.facts), assets: p.assetContent,
      base: this.base('review', { baseContent: task.baseContent, opinion: task.revisionOpinion || task.opinion, humanOpinion: task.opinion, automatic: task.revisionReview }),
      continuity: p.continuity, content: p.content,
    })
  }

  toReviseSegments(content, opinion) {
    return this.compose('revise', { baseContent: content, opinion, humanOpinion: this.task.opinion || '', automatic: true })
  }
}

const named = kind => class extends TextStepModel { constructor(task) { super(kind, task) } }
export const ShotTableModel = named('shots')
export const ShotSecondsModel = named('shot-seconds')
export const ShotRevisionModel = named('shot-revise')
export const ImagePromptModel = named('image-prompt')

// 文本接口：按任务选择步骤，三类请求均由 TextStepModel 组装。
export const stepInterface = kindOf => ({
  generate: task => new TextStepModel(kindOf(task), task).toGenerateSegments(),
  review: (task, content) => new TextStepModel(kindOf(task), task).toReviewSegments(content),
  revise: (task, content, opinion) => new TextStepModel(kindOf(task), task).toReviseSegments(content, opinion),
})
