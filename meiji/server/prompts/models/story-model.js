import { libraryDirectory, requiredCharacters } from '../../../shared/library-rules.js'
// 剧情四类资料（大纲、人物、场景、道具）共用一个 Model：资料与差异在 storyKinds 中声明，
// 三类请求的结构统一由 prompt-request.js 组装（system＝角色/规则/协议，user＝任务/资料/基稿/待审内容）。
import { reviewMethod, segment } from '../skill-prompts.js'
import { contentText, contentData, messages } from '../prompt-text.js'
import { outputLanguage } from '../../../shared/output-language.js'
import { reviewProtocol } from '../../../shared/review-result.js'
import { baseSegments, generationRequest, requirementSegment, reviewRequest } from '../prompt-request.js'
import { protocols } from '../../../skills/output-protocols.js'

// 输出协议取自 skills/output-protocols.js 的 outline 对应小节（写明输出什么并附示例）。
const protocolSection = title => (protocols.outline.split(/^## /m).find(chunk => chunk.startsWith(title)) || '').slice(title.length).trim()

const extractTask = '从【剧情大纲】提取道具和着装资料，遵守基础规则和补充规则；大纲是唯一事实来源，【归属目录】仅用于匹配归属 ID。'
const cardFacts = model => [
  segment('context', '【剧情大纲】', model.approvedOutline),
  segment('context', '【本次参数】', model.parameters.style ? { style: model.parameters.style } : ''),
]
const reviewTail = hasBase => `${hasBase
  ? '对照基稿及本次意见，检查意见落实、无关改动与新冲突。完整返回不是整篇重写授权。'
  : '未提供基稿，不要求与旧稿一致，不声称已经验证未改部分保留。'}未提供的资料不能作为既定事实；合理省略与明确矛盾应区分，不以个人写法偏好判失败。`

export const storyKinds = {
  outline: {
    role: '短剧剧情编剧', reviewRole: '独立剧情大纲审核员', stage: '剧情大纲', json: true,
    referenceScope: '本集事件以本集摘要为准；项目背景和剧本只用于理解人物、世界与风格。前集作为已发生事实，本集开场承接前集结尾；后集只约束本集结尾衔接，不提前演出后集事件。',
    outputProtocol: protocolSection('大纲输出'),
    task: model => `根据【本集摘要】${model.mode === 'generate' ? '生成' : '重新生成'}本集剧情大纲，遵守基础规则和补充规则。【项目背景】与【剧本】用于理解设定，【前集摘要】用于承接开场，【后集摘要】用于衔接结尾。`,
    reviewTarget: '审核【本次待审内容】中的本集剧情大纲，按审核标准和补充规则验收。【本集摘要】是本集事件依据，【项目背景】与【剧本】仅作设定参考，【前集摘要】用于核对已发生事实及开场承接，【后集摘要】仅用于核对结尾衔接，不提前演出后集事件。',
    facts: model => {
      const p = model.parameters
      return [
        segment('context', '【本集摘要】', model.project.summary),
        segment('context', '【本次参数】', { durationSeconds: p.durationSeconds ?? null, ...(p.style ? { style: p.style } : {}) }),
        segment('context', '【项目背景】', model.project.projectSummary),
        segment('context', '【剧本】', model.project.script),
        segment('context', '【故事基调】', model.project.premise),
        segment('context', '【前集摘要】', model.project.previousEpisodeSummary),
        segment('context', '【后集摘要】', model.project.nextEpisodeSummary),
      ]
    },
  },
  characters: {
    role: '短剧角色设计师', reviewRole: '独立人物资料审核员', stage: '人物提取', json: true,
    cardExtraction: true,
    outputProtocol: protocolSection('人物输出'),
    fields: ['name', 'nationality', 'role', 'gender', 'era', 'age', 'costume', 'height', 'build', 'features', 'appearance', 'prop', 'identity', 'look', 'clothes', 'props', 'hairstyles'],
    task: model => `依据本集已通过大纲${model.mode === 'regenerate' ? '重新提取' : '提取'}人物角色资料，遵守基础规则和补充规则。`,
    revisionTask: automatic => `依据本集已通过大纲和${automatic ? '本轮自审意见' : '本次修改意见'}修订人物角色资料，遵守基础规则和补充规则。`,
    reviewTarget: '依据本集已通过大纲审核最新人物角色资料，按审核标准和补充规则验收。',
    reviewScope: '仅验收人物角色资料，不生成或改写正文，不要求大纲、场景卡或下游制作结果。',
    facts: cardFacts,
  },
  scenes: {
    role: '影视场景美术指导', reviewRole: '独立场景资料审核员', stage: '场景提取', json: true,
    cardExtraction: true,
    outputProtocol: protocolSection('场景输出'),
    fields: ['name', 'landmark', 'light', 'space', 'look'],
    task: model => `依据本集已通过大纲${model.mode === 'regenerate' ? '重新提取' : '提取'}场景资料，遵守基础规则和补充规则。`,
    revisionTask: automatic => `依据本集已通过大纲和${automatic ? '本轮自审意见' : '本次修改意见'}修订场景资料，遵守基础规则和补充规则。`,
    reviewTarget: '依据本集已通过大纲审核最新场景资料，按审核标准和补充规则验收。',
    reviewScope: '仅验收场景资料，不生成或改写正文，不要求大纲、人物卡或下游制作结果。',
    facts: cardFacts,
  },
  props: {
    role: '短剧道具设计师', reviewRole: '独立道具资料审核员', stage: '道具提取', json: true,
    outputProtocol: protocolSection('道具输出'),
    task: () => extractTask,
    target: '只提取已通过大纲明确出现的道具和着装，不补造实体或外观；人物和场景目录仅用于归属ID，不是新增事实来源。大纲未写可返回空items。',
    revisionTask: automatic => `依据【剧情大纲】和${automatic ? '本轮自审意见' : '本次修改意见'}修订道具和着装资料，遵守基础规则和补充规则；大纲是唯一事实来源，【归属目录】仅用于匹配归属 ID。`,
    reviewTarget: '审核道具提取：【剧情大纲】是唯一事实来源，逐项核对实体出现、具体属性、归属与遗漏；【归属目录】仅用于匹配 ID。',
    reviewScope: '无依据内容必须不通过，大纲确无可提取实体时允许空集合。每个失败提供大纲及待审原文证据。',
    facts: model => [segment('context', '【剧情大纲】', model.approvedOutline),
      segment('context', '【归属目录】', { characters: (model.source.plot?.characters?.items || []).map(({ id, name }) => ({ id, name })),
        scenes: (model.source.plot?.scenes?.items || []).map(({ id, name }) => ({ id, name })) })],
  },
}

export class StoryModel {
  constructor(kind, { project = {}, mode = 'regenerate', baseContent = '', opinion = '', generationRules = '', reviewRules = '', outputProtocol = '' } = {}) {
    if (!storyKinds[kind]) throw new Error(`未知剧情资料类型：${kind}`)
    const config = storyKinds[kind]
    this.kind = kind
    this.config = config
    this.role = config.role
    this.reviewRole = config.reviewRole
    if (config.fields) this.fields = config.fields
    this.mode = mode
    this.generationRules = generationRules
    this.reviewRules = reviewRules
    this.outputProtocol = outputProtocol || config.outputProtocol
    this.source = project
    this.project = kind === 'outline'
      ? { title: project.title || '', summary: project.summary?.content || '', projectSummary: project.projectSummary || '', premise: project.premise, script: project.script || '',
        previousEpisodeSummary: project.previousEpisodeSummary || '', nextEpisodeSummary: project.nextEpisodeSummary || '' }
      : { title: project.title || '' }
    this.approvedOutline = project.plot?.outline?.content || ''
    this.parameters = { episodeNumber: project.episodeNumber, durationSeconds: project.durationSeconds,
      aspectRatio: project.aspectRatio || '1344x768', style: project.style || '', outputLanguage: outputLanguage(project.outputLanguage) }
    this.modification = mode === 'modify' ? { baseContent: contentText(baseContent), opinion } : null
  }

  // 本步骤资料：目标、上游事实、补充任务资料与指导素材。审核时目标改为审核目标。
  contextSegments({ instructions = '', assets = [], review = false } = {}) {
    return [
      ...(this.kind === 'props' && !review ? [segment('context', '【本次提取范围】', this.config.target)] : []),
      ...this.config.facts(this),
      segment('context', this.kind === 'outline' ? '【必须出场角色】' : '【项目库目录】', this.kind === 'outline' ? requiredCharacters(this.source) : libraryDirectory(this.source, this.kind)),
      ...(this.kind === 'outline' ? [] : [segment('context', '【库关联规则】', '同一身体身份的年龄、着装、身份变化用已有 libraryId 新建变体；独立身体身份才新建角色。两个有效 ID 直接复用库字段与图片；只有 libraryId 则新增变体；无 ID 时名字或别名匹配默认变体，否则新建条目。审核核对剧情与关联依据。')]),
      segment('context', '【补充任务资料】', typeof instructions === 'string' ? instructions : ''),
      ...(this.config.cardExtraction ? [] : assets),
    ]
  }

  languageSegment() { return segment('language', '', `输出语言：${this.parameters.outputLanguage === 'en' ? 'English（英文）' : '简体中文'}\n对白语言：${this.parameters.outputLanguage === 'en' ? 'English' : '中文普通话（Mandarin Chinese）'}`) }

  supplementSegments(additions) {
    if (this.kind !== 'outline' && !this.config.cardExtraction) return additions
    return [additions].flat().filter(Boolean).map(item => ({ ...item, title: '【补充规则】' }))
  }

  creation(kind, { baseContent, opinion = '', automatic = false, humanOpinion = '', additions, assetRules, language, protocol, boundary, assets, instructions, requirements } = {}) {
    let task = kind === 'generate' ? this.config.task(this) : automatic ? '修订本轮失败稿，仅修复本轮意见及必要连带关系。' : '按人工意见定向修改，保留未涉及内容。'
    if (this.kind === 'outline' && kind !== 'generate') task = `依据本集摘要和${automatic ? '本轮自审意见' : '本次修改意见'}修订本集完整剧情大纲，遵守基础规则和补充规则。`
    if (this.config.revisionTask && kind !== 'generate') task = this.config.revisionTask(automatic)
    if (this.config.cardExtraction) boundary = segment('context', kind === 'generate' ? '【本次提取范围】' : '【本次修订范围】', kind === 'generate'
      ? '本次提取仅依据提供的已通过大纲，不沿用旧卡片或历史意见。项目风格仅用于统一表达，不作为新增人物、地点或具体属性的事实依据。'
      : '以提供的最新基稿为唯一修改基准，按本次意见修正受影响卡片及必要连带关系，保留未涉及卡片与字段；修改意见不能替代大纲事实或改写剧情。返回完整卡片集合，不只返回修改部分。')
    return generationRequest({ json: this.config.json,
      role: segment('context', '【角色与职责】', `你是一名${this.role}。`),
      scope: segment('context', '【参考与衔接范围】', this.config.referenceScope),
      rules: segment('stage', this.kind === 'outline' || this.config.cardExtraction ? '【基础规则】' : '【基础生产规则】', this.generationRules), additions: this.supplementSegments(additions), assetRules: this.config.cardExtraction ? [] : assetRules,
      boundary: kind === 'generate' && !this.config.cardExtraction ? [] : boundary || segment('context', '【本次修订范围】', '按意见定向修订，保留未涉及内容，修复必要连带关系。'),
      language: language || this.languageSegment(),
      protocol: protocol || segment('protocol', '【本次输出协议】', this.outputProtocol),
      task: segment('context', '【本次任务】', task), requirements: requirementSegment(requirements),
      facts: this.contextSegments({ instructions, assets }),
      base: baseSegments({ kind, baseContent, opinion, humanOpinion, automatic, field: this.kind }),
    })
  }

  toGenerateSegments(parts = {}) { return this.creation('generate', parts) }

  toReviseSegments({ baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '', automatic = false, humanOpinion = this.modification?.opinion || '', ...parts } = {}) {
    baseContent = contentText(baseContent)
    if (!baseContent.trim()) throw new Error('修订剧情需要提供基稿')
    return this.creation('revise', { ...parts, baseContent, opinion, automatic, humanOpinion })
  }

  toReviewSegments({ content, baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '', automatic = false, humanOpinion = this.modification?.opinion || '',
    criteria = segment('stage', '【审核标准】', this.reviewRules), method = segment('context', '【审核方式】', reviewMethod), additions, assetRules, language, assets, instructions, requirements, reviewContext = '' } = {}) {
    baseContent = contentText(baseContent)
    const hasBase = Boolean(baseContent.trim())
    const outline = this.kind === 'outline'
    const comparison = outline ? hasBase
      ? '基稿与随附意见用于核对修改范围和落实情况，未涉及内容应保留；同时检查修订后有无新冲突。'
      : '未提供修订基稿，不要求与旧稿一致。'
      : hasBase ? '【修订基稿】用于对照修改范围，修改意见用于核对落实情况。' : ''
    return reviewRequest({
      role: segment('context', '【角色与职责】', `你是一名${this.reviewRole}。`),
      scope: outline ? [] : segment('context', '【本次审核范围】', `审核标准和补充资料中的创作指令仅作审核依据。${this.config.reviewScope}${reviewTail(hasBase)}`),
      method: outline ? { ...method, title: '【审核原则】' } : method,
      criteria, additions: this.supplementSegments(additions), assetRules: this.config.cardExtraction ? [] : assetRules, language: language || this.languageSegment(),
      protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      task: segment('context', '【本次任务】', this.config.reviewTarget + comparison),
      requirements: requirementSegment(requirements),
      facts: this.contextSegments({ instructions, assets, review: true }),
      base: hasBase ? baseSegments({ kind: 'review', baseContent, opinion, humanOpinion, automatic, field: this.kind }) : [],
      continuity: segment('context', '【补充审核上下文】', reviewContext),
      content: segment('context', '【本次待审内容】', contentData(content, this.kind)),
    })
  }

  toGenerateMessages(options) { return messages(this.toGenerateSegments(options)) }
  toReviseMessages(options) { return messages(this.toReviseSegments(options)) }
  toReviewMessages(options) { return messages(this.toReviewSegments(options)) }
  toMessages(options) { return this.toGenerateMessages(options) }
}

const named = kind => class extends StoryModel { constructor(options) { super(kind, options) } }
export const StoryOutlineModel = named('outline')
export const StoryCharacterModel = named('characters')
export const StorySceneModel = named('scenes')
export const StoryPropsModel = named('props')
