// 剧情四类资料接口：从技能快照取生产规则、审核标准、补充与协议，交给 StoryModel 按统一结构组装。
import { currentSkillSet, generationParts, reviewParts, segment, stageMeta } from '../skill-prompts.js'
import { checkContext } from '../../data/operation-context.js'
import { contentText } from '../prompt-text.js'
import { StoryOutlineModel } from '../models/story-model.js'
import { baseSegments, factSegments, requirementSegment, reviewRequest, taskInput } from '../request.js'
import { reviewProtocol } from '../../../shared/review-result.js'

const modelOf = task => task.model || new StoryOutlineModel({ project: task.project, generationRules: currentSkillSet(task.project, task.skillSet).skills.outline.rules.outline,
  reviewRules: currentSkillSet(task.project, task.skillSet).skills.outline.reviewRules.outline,
  mode: task.modify ? 'modify' : task.edited ? 'regenerate' : 'generate',
  baseContent: task.baseContent || '', opinion: task.opinion })
const requirements = () => checkContext.getStore()?.requirements || ''

export function sections(text, heading, selected) {
  const chunks = text.split(new RegExp(`^${heading} `, 'm'))
  if (chunks.length === 1) return text
  return [chunks[0], ...chunks.slice(1).filter(chunk => selected.includes(chunk.split('\n')[0].trim())).map(chunk => `${heading} ${chunk}`)].filter(Boolean).join('\n')
}

function creationParts(task, kind) {
  const model = modelOf(task)
  const p = generationParts({ ...task, stage: 'outline', nodeKey: model.kind, kind })
  return { additions: p.additions, assetRules: p.assetRules, language: p.language, boundary: p.revisionBoundary, assets: p.assetContent, requirements: requirements(),
    instructions: task.model ? '' : taskInput(task.instructions).task }
}

function generate(task) {
  const model = modelOf(task)
  const parts = creationParts(task, task.modify ? 'modify' : 'generate')
  return task.modify ? model.toReviseSegments({ ...parts, opinion: task.opinion }) : model.toGenerateSegments(parts)
}

function review(task, content) {
  const model = modelOf(task)
  const p = reviewParts({ ...task, stage: 'outline', nodeKey: model.kind }, content)
  if (task.edited) return reviewEditedContent(task, content, p)
  return model.toReviewSegments({ content, criteria: p.criteria, method: p.method, additions: p.additions, assetRules: p.assetRules, language: p.language, assets: p.assetContent,
    requirements: requirements(), instructions: task.model ? '' : taskInput(task.instructions).review || taskInput(task.instructions).task,
    ...(task.baseContent !== undefined ? { baseContent: task.baseContent } : {}),
    opinion: task.revisionOpinion || task.opinion, automatic: task.revisionReview || false, humanOpinion: task.opinion, reviewContext: task.reviewContext })
}

// 人工编辑的剧情资料同时核对大纲、人物与场景：审核标准合并三份对应的审核 skill。
function reviewEditedContent(task, content, p) {
  const baseContent = contentText(task.baseContent)
  const hasBase = Boolean(baseContent.trim())
  const automatic = task.revisionReview || false
  const reviews = currentSkillSet(task.project, task.skillSet).skills.outline.reviewRules || {}
  const input = taskInput(task.instructions)
  return reviewRequest({
    role: segment('context', '【角色与职责】', '你是一名独立剧情大纲审核员。'),
    scope: segment('context', '【本次审核范围】', `审核标准和补充资料中的创作指令仅作审核依据。先独立从最新大纲盘点实际出镜的身体身份和真实空间，再核对人物、场景卡的覆盖性与三部分一致性。${hasBase
      ? '对照基稿及本次意见，检查意见落实、无关改动与新冲突。完整返回不是整篇重写授权。'
      : '未提供基稿，不要求与旧稿一致，不声称已经验证未改部分保留。'}未提供的资料不能作为既定事实；合理省略与明确矛盾应区分，不以个人写法偏好判失败。`),
    method: p.method,
    criteria: segment('stage', '【审核标准】', [['大纲', 'outline'], ['人物角色', 'characters'], ['场景', 'scenes']]
      .filter(([, key]) => reviews[key]).map(([label, key]) => `〔${label}〕\n${reviews[key]}`).join('\n\n'), { skill: 'outline', field: 'review' }),
    additions: modelOf(task).supplementSegments(p.additions), assetRules: p.assetRules, language: p.language,
    protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
    stage: segment('context', '', '阶段：剧情整包'),
    task: segment('context', '【本次任务】', `${automatic ? '自动修订结果验收' : hasBase ? '人工修订结果验收' : '生成结果验收'}。审核提供的已编辑剧情资料，核对大纲与人物、场景的一致性；不生成或改写原文。${input.review ? `\n${input.review}` : ''}`),
    requirements: requirementSegment(requirements()),
    facts: factSegments(input.facts), assets: p.assetContent,
    base: hasBase ? baseSegments({ kind: 'review', baseContent, opinion: task.revisionOpinion || task.opinion, humanOpinion: task.opinion, automatic }) : [],
    continuity: segment('context', '【补充审核上下文】', task.reviewContext),
    content: segment('context', '【本次待审内容】', contentText(content)),
  })
}

function revise(task, content, review) {
  return modelOf(task).toReviseSegments({ ...creationParts(task, 'revise'), baseContent: content, opinion: review, automatic: true, humanOpinion: task.opinion || '' })
}
export default { generate, review, revise }
