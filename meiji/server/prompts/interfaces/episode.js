// 摘要接口：从技能快照取生产规则、审核标准、补充与协议，交给 EpisodeSummaryModel 按统一结构组装。
import { currentSkillSet, generationParts, reviewParts } from '../skill-prompts.js'
import { checkContext } from '../../data/operation-context.js'
import { EpisodeSummaryModel } from '../models/episode-summary-model.js'
import { taskInput } from '../request.js'

const modelOf = task => {
  if (task.model) return task.model
  const skills = currentSkillSet(task.project, task.skillSet).skills.episode
  return new EpisodeSummaryModel({ project: task.project, generationRules: skills.constraints, reviewRules: skills.review })
}
const requirements = () => checkContext.getStore()?.requirements || ''

function creationParts(task, kind) {
  const p = generationParts({ ...task, stage: 'episode', nodeKey: 'summary', kind })
  return { additions: p.additions, assetRules: p.assetRules, boundary: p.revisionBoundary, protocol: p.protocol, requirements: requirements(),
    instructions: task.model ? '' : taskInput(task.instructions).task }
}

function generate(task) {
  const model = modelOf(task)
  const parts = creationParts(task, task.modify ? 'modify' : 'generate')
  if (task.modify) return model.toReviseSegments({ ...parts, ...(task.model ? {} : { baseContent: task.baseContent }), opinion: task.opinion })
  return model.toGenerateSegments(parts)
}

function review(task, content) {
  const p = reviewParts({ ...task, stage: 'episode', nodeKey: 'summary' }, content)
  return modelOf(task).toReviewSegments({ content, criteria: p.criteria, method: p.method, additions: p.additions, requirements: requirements(),
    instructions: task.model ? '' : taskInput(task.instructions).review || taskInput(task.instructions).task,
    ...(task.baseContent !== undefined ? { baseContent: task.baseContent } : {}),
    opinion: task.revisionOpinion || task.opinion, automatic: task.revisionReview || false, humanOpinion: task.opinion, reviewContext: task.reviewContext })
}

function revise(task, content, review) {
  return modelOf(task).toReviseSegments({ ...creationParts(task, 'revise'), baseContent: content, opinion: review, automatic: true, humanOpinion: task.opinion || '' })
}

export default { generate, review, revise }
