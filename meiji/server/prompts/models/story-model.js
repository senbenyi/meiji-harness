import { filmCharacterSource, filmParticipants } from '../../../shared/film-characters.js'
import { creativeDirection } from '../../../shared/script-assembly.js'
import { episodeScriptScene } from '../../../shared/script-scenes.js'
import { libraryDirectory, requiredCharacters } from '../../../shared/library-rules.js'
import { characterExtractionContent, characterExtractionDirectory, characterExtractionFacts } from '../../../shared/character-extraction.js'
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
const characterOutputProtocol = protocols.characters

const cardFacts = model => [
  ...(model.source.scriptCharacterExtraction ? [segment('context', '【完整剧本】', model.source.script)] : model.filmCharacterExtraction ? [segment('context', '【已通过每秒指令：人物出镜唯一依据】', filmCharacterSource(model.source)), segment('context', '【本集参与人物清单：范围固定】', filmParticipants(model.source)), segment('context', '【已有角色声音与身份：复用资料】', (model.source.plot?.characters?.items || []).map(({name, sourceName, identity, voiceDescription}) => ({name, sourceName, identity, voiceDescription}))), segment('context', '【剧情大纲：仅作身份外貌背景】', model.approvedOutline)] : [segment('context', '【剧情大纲】', model.approvedOutline)]),
  segment('context', '【本次参数】', ''),
]
const reviewTail = hasBase => `${hasBase
  ? '对照基稿及本次意见，检查意见落实、无关改动与新冲突。完整返回不是整篇重写授权。'
  : '未提供基稿，不要求与旧稿一致，不声称已经验证未改部分保留。'}未提供的资料不能作为既定事实；合理省略与明确矛盾应区分，不以个人写法偏好判失败。`

export const storyKinds = {
  outline: {
    role: '短剧剧情编剧', reviewRole: '独立剧情大纲审核员', stage: '剧情大纲', json: false,
    referenceScope: '本集按【剧情依据优先级】确定：剧本模式依据剧本顺序提取，自由模式依据 AI 创作方向生成；前集故事为已发生事实，后集故事仅约束结尾衔接。摘要只作展示，不参与创作。',
    outputProtocol: protocolSection('大纲输出'),
    task: model => `${model.source.mode === 'free' ? '根据【AI 创作方向】，承接已发生的前集故事，直接生成' : '根据【剧本】顺序和已发生的前集故事，直接提取'}第 ${model.parameters.episodeNumber || 1} 集的编号故事小段，${model.scriptScene ? '严格对应本集指定分场，完整覆盖该场，不按时长跨场选取' : '按本集时长选择连续剧情'}，保留本集全部明确细节，遵守基础规则和补充规则。`,
    reviewTarget: '审核本集编号故事小段，按剧情依据优先级核对本集剧情细节、因果、连续性和结尾；摘要仅作展示，不能作为生成或审核依据。',
    facts: model => {
      const p = model.parameters
      return [
        segment('context', '【本次集序】', { episodeNumber: model.parameters.episodeNumber || 1 }),
        segment('context', '【本次参数】', { durationSeconds: p.durationSeconds ?? null, minDurationSeconds: Math.max(1, p.durationSeconds - 10), maxDurationSeconds: p.durationSeconds + 10 }),
        ...(model.scriptScene ? [segment('context', '【本集分场边界】', { number: model.scriptScene.number, title: model.scriptScene.title, rule: '一场对应一集；本场起止固定，完整保留事件、对白和结尾。不得跨场合并、拆分本场或提前演出下一场。', durationSeconds: model.scriptScene.durationSeconds }), segment('context', '【剧本共同设定：仅作背景】', model.scriptScene.common)] : []),
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
    outputProtocol: protocolSection('人物输出'),
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
    this.outputProtocol = outputProtocol || (kind === 'characters' ? characterOutputProtocol : config.outputProtocol)
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

  // 本步骤资料：目标、上游事实、补充任务资料与指导素材。审核时目标改为审核目标。
  contextSegments({ instructions = '', assets = [], review = false } = {}) {
    return [
      ...(this.kind === 'outline' ? [segment('context', '【剧情依据优先级】', this.source.plot?.outline?.sourceMode === 'manual' && (review || this.mode === 'modify')
        ? '当前基稿或待审故事小段是人工编辑版本，允许覆盖原始来源。按人工正文及本次意见检查内部因果、状态连续性和修改范围，不以删改原始来源判遗漏，不恢复已删除的情节或对白；原剧本或创作方向只作背景，不恢复人工删改内容。'
        : this.source.mode === 'free' ? '直接按 AI 创作方向及本次要求创作本集故事小段，承接前集已发生事实；创作方向是持续指导，不要求首集一次实现全部方向。摘要不参与创作。' : this.scriptScene ? '本集严格对应【本集分场边界】指定的一场，以【剧本】中的本场完整正文为依据。保留本场全部细节，不按时长重新划分、不跨场合并、不截断本场；共同设定仅作背景，前后集仅作衔接。摘要不参与创作。' : '直接从剧本按顺序选择适合本集时长的连续剧情，承接前集进度；所选剧情的全部明确细节须保留，不以精简、关键事件或时长预算为由遗漏。摘要不参与创作。')] : []),
      ...this.config.facts(this),
      segment('context', this.kind === 'outline' ? '【必须出场角色】' : '【项目库目录】', this.kind === 'outline' ? requiredCharacters(this.source) : this.kind === 'characters' ? characterExtractionDirectory(this.source) : libraryDirectory(this.source, this.kind)),
      ...(this.kind === 'outline' ? [] : [segment('context', '【库关联规则】', this.kind === 'characters'
        ? review
          ? '先查看项目库目录，按libraryId或名字/已登记别名核对关联。待审已有角色包含name、presence、libraryId，可附原文明示的新服装costumes增量，新增服装须审核原文依据，审核其本集范围、身份关联及参与类型；固定资料与图片由程序读取，不能把程序展开的外貌、服装或声线当作模型新写的内容，也不能要求删除已保存的库资料。目录以本轮提取开始时为准，不在目录中的本轮新角色仍按完整资料审核；发布入库不改变本轮分类。'
          : '先按重要角色建卡范围筛选，再查看项目库目录，按libraryId或名字/已登记别名匹配。已有角色返回剧情称谓name、presence及libraryId，可额外返回原文明示的新服装costumes增量，由程序直接引用固定身份、外貌、声音和已用图片；不重写库资料或重复新建。只有项目不存在的新角色返回完整资料。独立身体身份按剧情区分；审核核对范围和关联依据，完整外貌与声音要求仅用于新角色。'
        : '同一人物身份复用已有 libraryId；独立身体身份才新建角色。已有 libraryId 时复用该人物资料与图片；无 ID 时按名字或别名匹配，否则新建条目。审核核对剧情与关联依据。')]),
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

  creation(kind, { baseContent, opinion = '', automatic = false, humanOpinion = '', additions, assetRules, language, protocol, boundary, assets, instructions, requirements } = {}) {
    let task = kind === 'generate' ? this.config.task(this) : automatic ? '修订本轮失败稿，仅修复本轮意见及必要连带关系。' : '按人工意见定向修改，保留未涉及内容。'
    if (this.kind === 'outline' && kind !== 'generate') task = `依据当前剧情来源和${automatic ? '本轮自审意见' : '本次修改意见'}修订本集完整剧情大纲，遵守基础规则和补充规则。`
    if (this.config.revisionTask && kind !== 'generate') task = this.config.revisionTask(automatic)
    if (this.filmCharacterExtraction) task = kind === 'generate' ? '依据本集已通过每秒指令的participants清单，先匹配项目角色库：已有角色仅返回name、presence、libraryId，程序直接引用固定资料及图片；新visible准备外貌及声音，新voice仅准备身份与声音，不补造身体或生图。返回完整集合，大纲仅补充新角色身份外貌背景。同一人物跨镜复用，名称逐字沿用清单；仅提及人物和独立旁白不建卡，空清单返回items空数组。旧指令无清单时依据画面与实际发声者提取。' : '依据已通过的最终每秒指令和本次意见修订人物资料，已有项目角色继续直接引用，保留未涉及内容，不改写镜头、台词与时间。'
    if (this.config.cardExtraction) boundary = segment('context', kind === 'generate' ? '【本次提取范围】' : '【本次修订范围】', kind === 'generate'
      ? this.filmCharacterExtraction ? '参与范围以已通过每秒指令participants清单为准，不重新猜测或增删清单；清单与正文冲突须指出具体来源并要求先修正每秒指令。voice不建外貌，visible才准备图片；复用项目库已有身份、外貌及声音。旧指令无清单时兼容正文依据。' : this.kind === 'characters' ? '本集角色范围仅依据已通过大纲，不沿用旧卡片推导出场范围或历史意见。先筛选重要角色，排除背景群演和不符合准入条件的无名人物，再匹配项目库并直接引用固定资料；只有新角色设计完整资料，不从时代常识补造大纲未写的实体或属性。' : '本次提取仅依据提供的已通过大纲，不沿用旧卡片或历史意见。不要从时代常识或旧资料推导大纲未写出的实体或属性。'
      : '以提供的最新基稿为唯一修改基准，按本次意见修正受影响卡片及必要连带关系，保留未涉及卡片与字段；修改意见不能替代大纲事实或改写剧情。返回完整卡片集合，不只返回修改部分。')
    if (this.source.scriptCharacterExtraction) {
      task = kind === 'generate' ? '提取完整剧本全部场景中需要独立建卡的重要角色及全部明确服装。排除背景群演、普通功能人物和不满足准入条件的无名角色；已有身份复用，只补充原文明示的新服装。' : '依据完整剧本与本次意见修订重要角色及服装资料，保留未涉及内容。'
      boundary = segment('context', '【本次提取范围】', '完整剧本是本次唯一剧情来源，扫描全部场景，不受当前剧集或大纲限制。先执行重要角色筛选，再完整提取入选人物的明确外貌和衣着，未知不编造。')
    }
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
      task: segment('context', '【本次任务】', (this.source.scriptCharacterExtraction ? '依据完整剧本审核全部重要角色及服装；不要求单集大纲，检查群演和无名角色准入、特征准确归属以及服装完整性，空范围接受空集合。' : this.filmCharacterExtraction ? '依据已通过每秒指令participants清单审核人物范围、身体身份与声音一致性，不重新推导范围或增删清单；visible有视觉资料，voice只要求身份和声音。清单冲突须先修正每秒指令；大纲仅作背景，空清单接受空集合。旧指令无清单时核对正文和发声者。' : this.config.reviewTarget) + comparison),
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
