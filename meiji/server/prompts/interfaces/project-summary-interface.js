import { generationParts, reviewParts, currentSkillSet } from '../skill-prompts.js'
import { ProjectSummaryModel } from '../models/project-summary-model.js'

const modelOf = task => new ProjectSummaryModel({ project: task.project,
  generationRules: currentSkillSet(task.project).skills['project-summary'].constraints,
  reviewRules: currentSkillSet(task.project).skills['project-summary'].review })
const parts = (task, kind) => {
  const p = generationParts({ ...task, stage: 'project-summary', nodeKey: 'project-summary', kind })
  return { additions: p.additions, boundary: kind === 'generate' ? [] : p.revisionBoundary, language: p.language, protocol: p.protocol }
}
export default {
  generate: task => modelOf(task).toGenerateSegments({ ...parts(task, 'generate'), opinion: task.opinion }),
  revise: (task, content, review) => modelOf(task).toReviseSegments({ ...parts(task, 'revise'), baseContent: content, opinion: review }),
  review: (task, content) => {
    const p = reviewParts({ ...task, stage: 'project-summary', nodeKey: 'project-summary' }, content)
    return modelOf(task).toReviewSegments({ content, method: p.method, criteria: p.criteria, additions: p.additions, language: p.language,
      baseContent: task.baseContent, opinion: task.revisionOpinion, automatic: task.revisionReview })
  },
}
