// 摘要接口选择技能快照片段；三类请求分别由 model 编排。
import { currentSkillSet, generationParts, reviewParts, segment, part } from '../skill-prompts.js'
import { checkContext } from '../../data/operation-context.js'
import { EpisodeSummaryModel } from '../models/episode-summary-model.js'

const modelOf = task => task.model || new EpisodeSummaryModel({ project: task.project, generationRules: currentSkillSet(task.project, task.skillSet).skills.episode.constraints })
const contextOf = (task, review = false) => ({
  instructions: task.model ? '' : review ? task.reviewInstructions || task.instructions : task.instructions,
  requirements: checkContext.getStore()?.requirements || '',
})

function creationParts(task, kind) {
  const p = generationParts({ ...task, stage: 'episode', nodeKey: 'summary', kind })
  return { system: [p.common, ...p.commonShared, ...p.guidance, ...p.additions, ...p.assetRules],
    boundary: p.revisionBoundary, protocol: p.protocol }
}

function generate(task) {
  const model = modelOf(task)
  const parts = creationParts(task, task.modify ? 'modify' : 'generate')
  if (task.modify) return model.toReviseSegments({ ...parts, ...contextOf(task),
    ...(task.model ? {} : { baseContent: task.baseContent || task.instructions }), opinion: task.opinion })
  return model.toGenerateSegments({ ...parts, ...contextOf(task) })
}

function review(task, content) {
  const p = reviewParts({ ...task, stage: 'episode', nodeKey: 'summary' }, content)
  const set = currentSkillSet(task.project, task.skillSet)
  return modelOf(task).toReviewSegments({ ...contextOf(task, true), content,
    criteria: p.criteria,
    system: [segment('stage', '【其他创作要求（仅作验收依据）】', part(set, 'episode', 'common'), { skill: 'episode', field: 'common' }),
      ...p.additions, ...p.guidance],
    ...(task.baseContent !== undefined ? { baseContent: task.baseContent } : {}),
    opinion: task.revisionOpinion || task.opinion,
    automatic: task.revisionReview || false,
    humanOpinion: task.opinion,
    reviewContext: task.reviewContext,
  })
}

function revise(task, content, review) {
  return modelOf(task).toReviseSegments({ ...creationParts(task, 'revise'), ...contextOf(task, true),
    baseContent: content, opinion: review, automatic: true, humanOpinion: task.opinion || '' })
}

export default { generate, review, revise }
