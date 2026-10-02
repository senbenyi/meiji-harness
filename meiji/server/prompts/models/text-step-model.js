// 文本步骤的统一组装器：镜头表、整集/单镜每秒指令、单镜修订、图片提示词改写共用同一套
// 生成 / 审核 / 修订编排（结构见 request.js），各步骤只在 textSteps 中声明差异；输出协议统一来自 skills/protocols.js。
import { currentSkillSet, generationParts, reviewParts, segment } from '../skill-prompts.js'
import { baseSegments, factSegments, generationRequest, requirementSegment, reviewRequest, taskInput } from '../request.js'

export const textSteps = {
  shots: { stage: 'shots', role: '短剧镜头规划师', reviewRole: '独立短剧镜头规划师审核员', json: false,
    reviewTask: '验收本集完整镜头表：剧情覆盖、时长与编号、条目格式及镜头之间的承接。' },
  'episode-seconds': { stage: 'seconds', role: '整集每秒指令编剧', reviewRole: '独立整集每秒指令编剧审核员', json: true,
    reviewTask: '验收整集每秒指令：逐镜核对与已通过镜头表的一致性，以及镜头之间的交接。' },
  'shot-seconds': { stage: 'seconds', role: '单镜每秒指令编剧', reviewRole: '独立单镜每秒指令编剧审核员', json: true,
    reviewTask: '验收本镜每秒指令与已通过镜头表的一致性，以及与相邻镜头的衔接。' },
  'shot-revise': { stage: 'shot-revise', role: '单镜剧情修订师', reviewRole: '独立单镜剧情修订师审核员', json: false,
    scope: '只处理本次指定镜头，沿用已保存的编号和时长；未要求改动的剧情事实保持不变，核对前后镜状态、身体身份与空间关系。若需调整跨段边界或其他镜头，指出具体缺口，由镜头表任务重新规划，不在本次修改其他镜头，不将全表问题声称为已经全部修复。',
    reviewTask: '验收本次指定镜头的修订结果：意见落实、改动范围与前后镜衔接。' },
  // 图片提示词改写没有独立基础 skill 文件，生成规则在此定义；自审使用 review-image-prompt-skill.md。
  'image-prompt': { stage: 'image-prompt', role: '图片提示词设计师', reviewRole: '独立图片提示词设计师审核员', json: false,
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

  compose(kind, { baseContent = '', opinion = '', humanOpinion = '', automatic = false } = {}) {
    const { stage, role, json } = this.config
    const p = generationParts({ ...this.task, stage, kind, rules: this.generationRules })
    return generationRequest({ json,
      role: segment('context', '【角色与职责】', `你是一名${role}。完成本次指定任务，遵守上游事实和基础生产规则。`),
      scope: this.scope(), rules: p.generate, additions: p.additions, assetRules: p.assetRules,
      boundary: kind === 'generate' ? [] : p.revisionBoundary, language: p.language, protocol: p.protocol,
      task: segment('context', '【本次任务】', this.input.task), requirements: requirementSegment(),
      facts: factSegments(this.input.facts), assets: p.assetContent,
      base: baseSegments({ kind, baseContent, opinion, humanOpinion, automatic }),
    })
  }

  toGenerateSegments() {
    return this.task.modify
      ? this.compose('modify', { baseContent: this.task.baseContent, opinion: this.task.opinion })
      : this.compose('generate', { opinion: this.task.opinion })
  }

  toReviewSegments(content) {
    const { task } = this
    const p = reviewParts({ ...task, stage: this.config.stage }, content)
    return reviewRequest({
      role: segment('context', '【角色与职责】', `你是一名${this.config.reviewRole}，验收最新待审内容。`),
      scope: this.scope(), method: p.method, criteria: p.criteria, additions: p.additions, assetRules: p.assetRules, language: p.language, protocol: p.protocol,
      stage: p.stage, task: segment('context', '【审核目标】', this.input.review || this.config.reviewTask), requirements: requirementSegment(),
      facts: factSegments(this.input.facts), assets: p.assetContent,
      base: baseSegments({ kind: 'review', baseContent: task.baseContent, opinion: task.revisionOpinion || task.opinion, humanOpinion: task.opinion, automatic: task.revisionReview }),
      continuity: p.continuity, content: p.content, closing: p.closing,
    })
  }

  toReviseSegments(content, opinion) {
    return this.compose('revise', { baseContent: content, opinion, humanOpinion: this.task.opinion || '', automatic: true })
  }
}

const named = kind => class extends TextStepModel { constructor(task) { super(kind, task) } }
export const ShotTableModel = named('shots')
export const EpisodeSecondsModel = named('episode-seconds')
export const ShotSecondsModel = named('shot-seconds')
export const ShotRevisionModel = named('shot-revise')
export const ImagePromptModel = named('image-prompt')

// 文本接口：按任务选择步骤，三类请求均由 TextStepModel 组装。
export const stepInterface = kindOf => ({
  generate: task => new TextStepModel(kindOf(task), task).toGenerateSegments(),
  review: (task, content) => new TextStepModel(kindOf(task), task).toReviewSegments(content),
  revise: (task, content, opinion) => new TextStepModel(kindOf(task), task).toReviseSegments(content, opinion),
})
