import { segment } from '../skill-prompts.js'
import { reviewProtocol } from '../../../shared/review-result.js'
import { contentText } from '../prompt-text.js'
export class StoryPropsModel {
  constructor({ project, generationRules, mode, baseContent, opinion }) {
    this.kind = 'props'; this.generationRules = generationRules; this.mode = mode
    this.baseContent = baseContent; this.opinion = opinion
    this.context = { outline: project.plot.outline.content,
      characters: project.plot.characters.items.map(({ id, name }) => ({ id, name })),
      scenes: project.plot.scenes.items.map(({ id, name }) => ({ id, name })) }
  }
  contextSegments({ requirements = '', assets = [] } = {}) { return [segment('context', '【唯一事实来源：大纲；人物与场景目录仅匹配归属ID】', JSON.stringify(this.context)), segment('context', '【本次要求】', requirements), ...assets] }
  toGenerateSegments({ system = [], protocol, ...context } = {}) {
    return { json: true, system: [segment('context', '【角色与职责】', '只提取已通过大纲明确出现的道具和着装，不补造实体或外观；人物和场景目录仅用于归属ID，不是新增事实来源。大纲未写可返回空items。'), segment('stage', '【生成要求】', this.generationRules), ...system, protocol], user: this.contextSegments(context) }
  }
  toReviseSegments({ baseContent = this.baseContent, opinion = this.opinion, ...options } = {}) {
    const result = this.toGenerateSegments(options)
    result.user.push(segment('context', '【修改基稿】', contentText(baseContent)), segment('context', '【修改意见】', opinion))
    return result
  }
  toReviewSegments({ content, system = [], baseContent = this.baseContent, opinion = this.opinion, ...context } = {}) {
    return { json: true, system: [segment('context', '【角色与职责】', '只审核道具提取：逐项对照大纲原句，核对实体出现、具体属性、归属与遗漏；人物卡和场景卡不能作证据。无依据内容必须不通过，大纲确无可提取实体时允许空集合。每个失败提供大纲及待审原文证据。'), segment('stage', '【验收标准】', this.generationRules), ...system, segment('protocol', '【本次审核协议】', reviewProtocol)], user: [...this.contextSegments(context), segment('context', '【修订基稿】', contentText(baseContent)), segment('context', '【修改意见】', opinion), segment('context', '【待审道具】', contentText(content))] }
  }
}
