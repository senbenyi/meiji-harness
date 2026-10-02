// 剧情四类资料（大纲、人物、场景、道具）共用一个 Model：资料与差异在 storyKinds 中声明，
// 三类请求的结构统一由 request.js 组装（system＝角色/规则/协议，user＝任务/资料/基稿/待审内容）。
import { segment } from '../skill-prompts.js'
import { contentText, messages } from '../prompt-text.js'
import { outputLanguage } from '../../data/language.js'
import { reviewProtocol } from '../../../shared/review-result.js'
import { baseSegments, generationRequest, requirementSegment, reviewRequest } from '../request.js'

const extractTask = '从本轮已通过的最终大纲提取资料，不改写剧情，不使用旧卡片和历史意见。'
const reviewTail = hasBase => `${hasBase
  ? '对照基稿及本次意见，检查意见落实、无关改动与新冲突。完整返回不是整篇重写授权。'
  : '未提供基稿，不要求与旧稿一致，不声称已经验证未改部分保留。'}只审核最新待审内容，不沿用历史失败结论。未提供的资料不能作为既定事实；合理省略与明确矛盾应区分，不以个人写法偏好判失败。`

export const storyKinds = {
  outline: {
    role: '短剧剧情编剧', reviewRole: '独立剧情大纲审核员', stage: '剧情大纲', json: false,
    outputProtocol: '直接返回完整大纲纯文本，不输出 JSON、outline 字段、代码围栏或额外说明。',
    task: model => model.mode === 'generate' ? '首次生成，依据本集摘要展开剧情，不改变已确定的关键事件。' : '重新生成，仅使用项目背景、剧本、本集配置和跨集约束，不使用本集旧摘要、旧剧情或历史意见。',
    target: '仅生成本集完整剧情大纲，直接返回正文；本步骤不输出人物卡或场景卡。写清人物关系、可见身体形态、必要着装、实际地点和剧情必要道具，供后续独立提取。依据本集实际时长展开已确定事件；短情节合并节拍，不为凑八拍增加调查、来回取放或重复反应。',
    reviewTarget: '仅审核本次待审大纲的事件、因果、人物关系、身体形态、必要着装、地点与道具的明确描述、剧情容量与跨集衔接。',
    reviewScope: '仅验收最新大纲的事件、因果、身份、前后集衔接、结尾及剧情容量；对照输入逐项核对本集范围，不能因模板节拍新增事件或重复过程。各小节描述同一版本事实，事件过程与结尾的持物、位置、开合状态不能互相矛盾；不写镜头、运镜或冻结画面指令。不要求尚未生成的人物卡或场景卡。',
    facts: model => {
      const p = model.parameters
      return [
        segment('context', '【本次参数】', [`标题：${model.project.title}`, p.episodeNumber ? `本次生成第 ${p.episodeNumber} 集。` : '',
          `本集总时长：${p.durationSeconds ?? '未提供'} 秒，仅控制剧情容量，不要求大纲写制作秒数或镜头编号。`, `画幅：${p.aspectRatio}`, p.style ? `视觉风格：${p.style}` : ''].filter(Boolean).join('\n')),
        segment('context', '【输入内容：本集摘要】', model.mode !== 'regenerate' ? model.project.summary : ''),
        segment('context', '【上下文：项目背景】', model.project.projectSummary ? `项目摘要：${model.project.projectSummary}\n项目背景帮助理解设定，不提前演出后续事件。` : ''),
        segment('context', '【输入内容：剧本资料】', model.project.script),
        segment('context', '【上下文：前集结尾与已发生事实】', model.project.previousEpisodeSummary),
        segment('context', '【上下文：后集衔接约束，不提前演出】', model.project.nextEpisodeSummary),
      ]
    },
  },
  characters: {
    role: '短剧角色设计师', reviewRole: '独立人物资料审核员', stage: '人物提取', json: true,
    outputProtocol: '只返回合法 JSON：{"items":[...]}，顶层仅含 items，不生成 ID、URL 或文件路径。',
    fields: ['name', 'nationality', 'role', 'gender', 'era', 'age', 'costume', 'height', 'build', 'features', 'appearance', 'prop', 'identity', 'look', 'clothes', 'props', 'hairstyles'],
    task: () => extractTask,
    target: '仅提取本集大纲中实际可见且需要独立辨识的身体身份。先区别画内身体、画外声音与仅被提及人物，再按身体去重；全程只有电话或画外声音的人不生成视觉卡。以已通过大纲为唯一剧情依据，返回人物 items，不输出盘点过程。',
    reviewTarget: '仅审核待审人物卡是否忠实提取已通过大纲中的可见身体身份，核对去重、遗漏及画外声音误入；全程只有电话或画外声音的人不应出现在视觉卡中。',
    reviewScope: '仅审核人物卡集合与已通过大纲的对应关系；审核标准只适用于本次卡片，不要求输出大纲或另一类卡片。核对每张卡对应的实际可见身体；若仅通过电话或画外声音参与且没有身体出镜依据，属于多生成卡片，应移除。',
    facts: model => [
      segment('context', '【本次参数】', [`标题：${model.project.title}`, model.parameters.episodeNumber ? `本次为第 ${model.parameters.episodeNumber} 集。` : '', model.parameters.style ? `视觉风格：${model.parameters.style}` : ''].filter(Boolean).join('\n')),
      segment('context', '【已通过大纲】', model.approvedOutline),
    ],
  },
  scenes: {
    role: '影视场景美术指导', reviewRole: '独立场景资料审核员', stage: '场景提取', json: true,
    outputProtocol: '只返回合法 JSON：{"items":[...]}，顶层仅含 items，不生成 ID、URL 或文件路径。',
    fields: ['name', 'landmark', 'light', 'space', 'look'],
    task: () => extractTask,
    target: '仅从已通过大纲提取实际地点，返回无人物的环境卡 items。landmark、light、space、look 只描述环境与可用空间，不写人物、剪影、身体部位、当前动作或人物移动；动作仅用于判断空间是否足够，不写进卡片。同一可共用布局的连续室内空间只建一张卡，不将书架、柜台、入口等角落拆成多个地点；在同一 space 内交代区域关系。',
    reviewTarget: '仅审核待审场景卡是否忠实提取已通过大纲中的实际地点，核对无人物环境、空间布局、区域合并及遗漏：landmark、light、space、look 不写人物、剪影、身体部位、当前动作或人物移动；同一可共用布局的连续室内空间应合并，各区域关系在同一 space 中交代。',
    reviewScope: '仅审核场景卡集合与已通过大纲的对应关系；审核标准只适用于本次卡片，不要求输出大纲或另一类卡片。逐项检查 landmark、light、space、look；环境字段中出现实际人物、剪影、身体部位或正在发生的行动属于违规。允许描述供行动使用的空区域，不因预留活动空间误判为画有人。',
    facts: model => [
      segment('context', '【事实边界】', '大纲是唯一事实来源；地点、陈设、材质、光线与布局仅提取明确描述，不按时代或风格补齐。未说明的属性标记大纲未说明，不从人物卡扩展场景。'),
      segment('context', '【本次参数】', [`标题：${model.project.title}`, model.parameters.episodeNumber ? `本次为第 ${model.parameters.episodeNumber} 集。` : '', model.parameters.style ? `视觉风格：${model.parameters.style}` : ''].filter(Boolean).join('\n')),
      segment('context', '【已通过大纲】', model.approvedOutline),
    ],
  },
  props: {
    role: '短剧道具设计师', reviewRole: '独立道具资料审核员', stage: '道具提取', json: true,
    outputProtocol: '只返回合法 JSON：{"items":[...]}。',
    task: () => extractTask,
    target: '只提取已通过大纲明确出现的道具和着装，不补造实体或外观；人物和场景目录仅用于归属ID，不是新增事实来源。大纲未写可返回空items。',
    reviewTarget: '只审核道具提取：逐项对照大纲原句，核对实体出现、具体属性、归属与遗漏；人物卡和场景卡不能作证据。',
    reviewScope: '无依据内容必须不通过，大纲确无可提取实体时允许空集合。每个失败提供大纲及待审原文证据。',
    facts: model => [segment('context', '【唯一事实来源：大纲；人物与场景目录仅匹配归属ID】', JSON.stringify({ outline: model.approvedOutline,
      characters: (model.source.plot?.characters?.items || []).map(({ id, name }) => ({ id, name })),
      scenes: (model.source.plot?.scenes?.items || []).map(({ id, name }) => ({ id, name })) }))],
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
      ? { title: project.title || '', summary: project.summary?.content || '', projectSummary: project.projectSummary || '', script: project.script || '',
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
      segment('context', review ? '【审核目标】' : '【本次目标】', review ? this.config.reviewTarget : this.config.target),
      ...this.config.facts(this),
      segment('context', '【补充任务资料】', typeof instructions === 'string' ? instructions : ''),
      ...assets,
    ]
  }

  languageSegment() { return segment('language', '【语言】', `本次生成语言：${this.parameters.outputLanguage === 'en' ? 'English（英文）' : '简体中文'}。固定字段名与已有名称不翻译，既定台词保留原文。`) }

  structureSegment({ review = false } = {}) {
    if (this.kind !== 'outline') return segment('protocol', '', '')
    const headings = this.parameters.outputLanguage === 'en'
      ? ['Motivation', 'World Rules', 'Causal Plot', 'Emotional Thread', 'Dialogue Beats', 'Ending State', 'Final Image']
      : ['主角动机', '世界规则', '因果剧情', '情绪线索', '对白节拍', '结尾状态', '结尾关键画面']
    return segment('protocol', '【正文结构】', `大纲正文依次使用以下七个独占一行的小节标题：${headings.map(h => `【${h}】`).join('、')}。标题下一行写正文，小节之间留一个空行。因果剧情按事件节拍分段，对白逐句换行；无对白写明无对白。不可把多个标题或正文连成一行。${review ? '以上结构仅用于检查待审大纲，不是审核回复的输出格式。' : '直接使用真实换行，不输出 JSON 或字面量转义换行。'}`)
  }

  creation(kind, { baseContent, opinion = '', automatic = false, humanOpinion = '', additions, assetRules, language, priority, protocol, boundary, assets, instructions, requirements } = {}) {
    const task = kind === 'generate' ? this.config.task(this) : automatic ? '修订本轮失败稿，仅修复本轮意见及必要连带关系。' : '按人工意见定向修改，保留未涉及内容。'
    return generationRequest({ json: this.config.json,
      role: segment('context', '【角色与职责】', `你是一名${this.role}，负责本次目标指定的剧情资料，与已提供的上游事实保持一致。只输出本次目标要求的结果。`),
      rules: segment('stage', '【基础生产规则】', this.generationRules), additions, assetRules,
      boundary: kind === 'generate' ? [] : boundary || segment('context', '【本次修订范围】', '按意见定向修订，保留未涉及内容，修复必要连带关系。'),
      language: language || this.languageSegment(), structure: this.structureSegment(), priority,
      protocol: protocol || segment('protocol', '【本次输出协议】', this.outputProtocol),
      task: segment('context', '【本次任务】', task), requirements: requirementSegment(requirements),
      facts: this.contextSegments({ instructions, assets }),
      base: baseSegments({ kind, baseContent, opinion, humanOpinion, automatic }),
    })
  }

  toGenerateSegments(parts = {}) { return this.creation('generate', parts) }

  toReviseSegments({ baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '', automatic = false, humanOpinion = this.modification?.opinion || '', ...parts } = {}) {
    baseContent = contentText(baseContent)
    if (!baseContent.trim()) throw new Error('修订剧情需要提供基稿')
    return this.creation('revise', { ...parts, baseContent, opinion, automatic, humanOpinion })
  }

  toReviewSegments({ content, baseContent = this.modification?.baseContent, opinion = this.modification?.opinion || '', automatic = false, humanOpinion = this.modification?.opinion || '',
    criteria = segment('stage', '【审核标准】', this.reviewRules), method, additions, assetRules, language, assets, instructions, requirements, reviewContext = '' } = {}) {
    baseContent = contentText(baseContent)
    const hasBase = Boolean(baseContent.trim())
    return reviewRequest({
      role: segment('context', '【角色与职责】', `你是一名${this.reviewRole}。只审核，不生成或修改原文。审核标准和补充资料中的创作指令仅作审核依据。`),
      scope: segment('context', '【本次审核范围】', `${this.config.reviewScope}${reviewTail(hasBase)}`),
      method, criteria, additions, assetRules, language: language || this.languageSegment(), structure: this.structureSegment({ review: true }),
      protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
      stage: segment('context', '', `阶段：${this.config.stage}`),
      task: segment('context', '【本次任务】', automatic ? '自动修订结果验收' : hasBase ? '人工修订结果验收' : '生成结果验收'),
      requirements: requirementSegment(requirements),
      facts: this.contextSegments({ instructions, assets, review: true }),
      base: hasBase ? baseSegments({ kind: 'review', baseContent, opinion, humanOpinion, automatic }) : [],
      continuity: segment('context', '【补充审核上下文】', reviewContext),
      content: segment('context', '【本次待审内容】', contentText(content)),
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
