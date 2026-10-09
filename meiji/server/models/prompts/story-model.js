import { filmCharacterSource, filmParticipants } from '../../../shared/film-characters.js'
import { creativeDirection } from '../../../shared/script-assembly.js'
import { episodeScriptScene } from '../../../shared/script-scenes.js'
import { libraryDirectory, requiredCharacters } from '../../../shared/library-rules.js'
import { characterExtractionContent, characterExtractionDirectory, characterExtractionFacts } from '../../../shared/character-extraction.js'
// 大纲、人物、场景共用一个 Model。差异在 storyKinds；请求结构由 prompt-request.js 组装。
import { reviewMethod, segment } from '../../prompts/skill-prompts.js'
import { contentText, contentData, messages } from '../../prompts/prompt-text.js'
import { outputLanguage } from '../../../shared/output-language.js'
import { reviewProtocol } from '../../../shared/review-result.js'
import { baseSegments, generationRequest, requirementSegment, reviewRequest } from '../../prompts/prompt-request.js'
import { protocols } from '../../../skills/output-protocols.js'

const protocolSection = title => (protocols.outline.split(/^## /m).find(chunk => chunk.startsWith(title)) || '').slice(title.length).trim()

const cardFacts = model => [
  ...(model.source.scriptCharacterExtraction ? [segment('context', '【完整剧本】', model.source.script)]
    : model.filmCharacterExtraction ? [
      segment('context', '【已通过每秒指令：人物出镜唯一依据】', filmCharacterSource(model.source)),
      segment('context', '【本集参与人物清单：范围固定】', filmParticipants(model.source)),
      segment('context', '【已有角色声音与身份：复用资料】', (model.source.plot?.characters?.items || []).map(({ name, sourceName, identity, voiceDescription }) => ({ name, sourceName, identity, voiceDescription }))),
      segment('context', '【剧情大纲：仅作身份外貌背景】', model.approvedOutline),
    ] : [segment('context', '【剧情大纲】', model.approvedOutline)]),
  segment('context', '【本次参数】', ''),
]
const reviewTail = hasBase => `${hasBase
  ? '对照基稿及本次意见，检查意见落实、无关改动与新冲突。完整返回不是整篇重写授权。'
  : '未提供基稿，不要求与旧稿一致，不声称已经验证未改部分保留。'}未提供的资料不能作为既定事实；合理省略与明确矛盾应区分，不以个人写法偏好判失败。`

// 来源规则只出现在【剧情依据优先级】。任务句不再复述。
function outlinePriority(model, review) {
  if (model.source.plot?.outline?.sourceMode === 'manual' && (review || model.mode === 'modify')) return '当前内容是人工编辑版本，允许覆盖原始来源。按人工正文及本次意见检查因果、连续性和修改范围，不恢复人工删改内容；原剧本或创作方向只作背景。'
  if (model.source.mode === 'free') return '直接按 AI 创作方向及本次要求创作本集故事小段，承接前集已发生事实；创作方向持续指导各集，不要求首集一次实现。摘要不参与创作。'
  if (model.scriptScene) return '本集严格对应【本集分场边界】指定的一场，一场对应一集。以【剧本】中的本场完整正文为依据，保留全部细节，不按时长重新划分、不跨场合并、不拆分或截断本场，不提前演出下一场。共同设定仅作背景，前后集仅作衔接。摘要不参与创作。'
  return '直接从剧本按顺序选择适合本集时长的连续剧情，承接前集进度；所选剧情的全部明确细节须保留，不以精简、关键事件或时长预算为由遗漏。摘要不参与创作。'
}

function libraryRule(model, review) {
  if (model.kind === 'characters') return segment('context', '【库关联规则】', review
    ? '先查看项目库目录，按 libraryId、名字或已登记别名核对。已有角色的固定资料由程序读取，不能当成新写内容，也不要求删除已保存资料。'
    : '先查看项目库目录，按 libraryId、名字或已登记别名匹配。已有角色只返回引用，固定资料由程序读取。')
  return segment('context', '【库关联规则】', '按【项目库目录】复用场景：两个 ID 表示复用现有变体，仅 libraryId 表示新增变体，都没有则新建。')
}

export const storyKinds = {
  outline: {
    role: '短剧剧情编剧', reviewRole: '独立剧情大纲审核员', stage: '剧情大纲', json: false,
    outputProtocol: protocolSection('大纲输出'),
    task: model => `生成第 ${model.parameters.episodeNumber || 1} 集的编号故事小段，遵守基础规则和补充规则。`,
    reviewTarget: '审核本集编号故事小段，按剧情依据优先级核对；摘要仅作展示。',
    facts: model => {
      const p = model.parameters
      return [
        segment('context', '【本次集序】', { episodeNumber: p.episodeNumber || 1 }),
        segment('context', '【本次参数】', { durationSeconds: p.durationSeconds ?? null, minDurationSeconds: Math.max(1, p.durationSeconds - 10), maxDurationSeconds: p.durationSeconds + 10 }),
        ...(model.scriptScene ? [
          segment('context', '【本集分场边界】', { number: model.scriptScene.number, title: model.scriptScene.title, durationSeconds: model.scriptScene.durationSeconds }),
          segment('context', '【剧本共同设定：仅作背景】', model.scriptScene.common),
        ] : []),
        segment('context', model.source.mode === 'free' ? '【已回写剧情：仅作已发生事实参考】' : '【剧本】', model.project.script),
        segment('context', '【AI 创作方向】', model.project.premise),
        segment('context', '【前集故事小段：已发生事实】', model.source.previousEpisodeOutlines || model.source.previousEpisodeOutline),
        segment('context', '【后集故事小段：仅作衔接】', model.source.nextEpisodeOutline),
      ]
    },
  },
  characters: {
    role: '短剧角色设计师', reviewRole: '独立人物资料审核员', stage: '人物提取', json: true,
    cardExtraction: true,
    outputProtocol: protocols.characters,
    fields: ['name', 'nationality', 'role', 'gender', 'era', 'age', 'costume', 'costumes', 'height', 'build', 'features', 'appearance', 'prop', 'identity', 'look', 'presence', 'voiceDescription'],
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
}

function actionTask(model, action, automatic) {
  if (model.source.scriptCharacterExtraction) return action === 'generate'
    ? '提取完整剧本中的重要角色及明确服装，遵守基础规则和补充规则。'
    : '依据完整剧本与本次意见修订重要角色及服装资料，保留未涉及内容。'
  if (model.filmCharacterExtraction) return action === 'generate'
    ? '依据已通过每秒指令的 participants 清单提取人物资料，遵守基础规则和补充规则。'
    : '依据已通过的每秒指令和本次意见修订人物资料，已有项目角色继续直接引用，保留未涉及内容。'
  if (action === 'generate') return model.config.task(model)
  if (model.kind === 'outline') return `依据当前剧情来源和${automatic ? '本轮自审意见' : '本次修改意见'}修订本集完整剧情大纲，遵守基础规则和补充规则。`
  if (model.config.revisionTask) return model.config.revisionTask(automatic)
  return automatic ? '修订本轮失败稿，仅修复本轮意见及必要连带关系。' : '按人工意见定向修改，保留未涉及内容。'
}

function actionBoundary(model, action) {
  if (model.source.scriptCharacterExtraction) return segment('context', '【本次提取范围】', '【完整剧本】是本次唯一剧情来源，扫描全部场景，不受当前剧集或大纲限制。')
  if (!model.config.cardExtraction) return action === 'generate' ? [] : segment('context', '【本次修订范围】', '按意见定向修订，保留未涉及内容，修复必要连带关系。')
  if (action !== 'generate') return segment('context', '【本次修订范围】', '以最新基稿为唯一修改基准，按本次意见修正受影响卡片，保留未涉及内容。返回完整卡片集合。')
  if (model.filmCharacterExtraction) return segment('context', '【本次提取范围】', '参与范围以已通过每秒指令的 participants 清单为准，不增删清单。清单与正文冲突时先修正每秒指令。')
  if (model.kind === 'characters') return segment('context', '【本次提取范围】', '本集角色范围仅依据已通过大纲，不沿用旧卡片推导出场范围或历史意见。')
  return segment('context', '【本次提取范围】', '本次提取仅依据已通过大纲，不沿用旧卡片或历史意见。')
}

function reviewTask(model, hasBase) {
  const comparison = model.kind === 'outline' ? hasBase
    ? '基稿与随附意见用于核对修改范围和落实情况，未涉及内容应保留；同时检查修订后有无新冲突。'
    : '未提供修订基稿，不要求与旧稿一致。'
    : hasBase ? '【修订基稿】用于对照修改范围，修改意见用于核对落实情况。' : ''
  const target = model.source.scriptCharacterExtraction
    ? '依据完整剧本审核全部重要角色及服装；不要求单集大纲。空范围接受空集合。'
    : model.filmCharacterExtraction
      ? '依据已通过每秒指令的 participants 清单审核人物范围，不增删清单。清单冲突须先修正每秒指令；大纲仅作背景。空清单接受空集合。'
      : model.config.reviewTarget
  return target + comparison
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
    this.scriptScene = kind === 'outline' ? episodeScriptScene(project) : null
    this.project = kind === 'outline'
      ? { title: project.title || '', premise: creativeDirection(project), script: this.scriptScene?.content ?? project.script ?? '' }
      : { title: project.title || '' }
    this.filmCharacterExtraction = kind === 'characters' && project.filmCharacterExtraction === true
    this.approvedOutline = project.plot?.outline?.content || ''
    this.parameters = { episodeNumber: project.episodeNumber, durationSeconds: project.durationSeconds,
      aspectRatio: project.aspectRatio || '1344x768', outputLanguage: outputLanguage(project.outputLanguage) }
    this.modification = mode === 'modify' ? { baseContent: contentText(baseContent), opinion } : null
  }

  contextSegments({ instructions = '', assets = [], review = false } = {}) {
    return [
      ...(this.kind === 'outline' ? [segment('context', '【剧情依据优先级】', outlinePriority(this, review))] : []),
      ...this.config.facts(this),
      segment('context', this.kind === 'outline' ? '【必须出场角色】' : '【项目库目录】', this.kind === 'outline' ? requiredCharacters(this.source) : this.kind === 'characters' ? characterExtractionDirectory(this.source) : libraryDirectory(this.source, this.kind)),
      ...(this.kind === 'outline' ? [] : [libraryRule(this, review)]),
      segment('context', '【本集要求】', this.kind === 'outline' ? this.source.storyRequirements || '' : ''),
      segment('context', '【补充任务资料】', typeof instructions === 'string' ? instructions : ''),
      ...(this.config.cardExtraction ? [] : assets),
    ]
  }

  languageSegment() { return segment('language', '', `输出语言：${this.parameters.outputLanguage === 'en' ? 'English（英文）' : '简体中文'}\n对白语言：${this.parameters.outputLanguage === 'en' ? 'English' : '中文普通话（Mandarin Chinese）'}`) }

  supplementSegments(additions) {
    if (this.kind !== 'outline' && !this.config.cardExtraction) return additions
    return [additions].flat().filter(Boolean).map(item => ({ ...item, title: '【补充规则】' }))
  }

  creation(action, { baseContent, opinion = '', automatic = false, humanOpinion = '', additions, assetRules, language, protocol, assets, instructions, requirements } = {}) {
    return generationRequest({ json: this.config.json,
      role: segment('context', '【角色与职责】', `你是一名${this.role}。`),
      rules: segment('stage', '【基础规则】', this.generationRules), additions: this.supplementSegments(additions), assetRules: this.config.cardExtraction ? [] : assetRules,
      boundary: actionBoundary(this, action),
      language: language || this.languageSegment(),
      protocol: protocol || segment('protocol', '【本次输出协议】', this.outputProtocol),
      task: segment('context', '【本次任务】', actionTask(this, action, automatic)), requirements: requirementSegment(requirements),
      facts: this.contextSegments({ instructions, assets }),
      base: baseSegments({ kind: action, baseContent, opinion, humanOpinion, automatic, field: this.kind }),
    })
  }

  toGenerateSegments(parts = {}) { return this.creation('generate', parts) }

  toReviseSegments({ baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '', automatic = false, humanOpinion = this.modification?.opinion || '', ...parts } = {}) {
    if (this.kind === 'characters') baseContent = characterExtractionContent(this.source, baseContent)
    baseContent = contentText(baseContent)
    if (!baseContent.trim()) throw new Error('修订剧情需要提供基稿')
    return this.creation('revise', { ...parts, baseContent, opinion, automatic, humanOpinion })
  }

  toReviewSegments({ content, baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '', automatic = false, humanOpinion = this.modification?.opinion || '',
    criteria = segment('stage', '【审核标准】', this.reviewRules), method = segment('context', '【审核方式】', reviewMethod), additions, assetRules, language, assets, instructions, requirements, reviewContext = '' } = {}) {
    if (this.kind === 'characters') {
      content = characterExtractionContent(this.source, content)
      baseContent = characterExtractionContent(this.source, baseContent)
    }
    baseContent = contentText(baseContent)
    const hasBase = Boolean(baseContent.trim())
    const outline = this.kind === 'outline'
    return reviewRequest({
      role: segment('context', '【角色与职责】', `你是一名${this.reviewRole}。`),
      scope: outline ? [] : segment('context', '【本次审核范围】', `审核标准和补充资料中的创作指令仅作审核依据。${this.config.reviewScope}${reviewTail(hasBase)}`),
      method: outline ? { ...method, title: '【审核原则】' } : method,
      criteria, additions: this.supplementSegments(additions), assetRules: this.config.cardExtraction ? [] : assetRules, language: language || this.languageSegment(),
      protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      task: segment('context', '【本次任务】', reviewTask(this, hasBase)),
      requirements: requirementSegment(requirements),
      facts: [...this.contextSegments({ instructions, assets, review: true }),
        ...(this.kind === 'characters' ? [segment('context', '【已有角色身份：只读库资料，不是待审生成稿】', characterExtractionFacts(this.source, content))] : [])],
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
