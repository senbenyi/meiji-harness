import { ScriptRevisionModel } from '../../models/prompts/script-revision-model.js'
import { generationParts, reviewParts, currentSkillSet } from '../skill-prompts.js'
const model = task => new ScriptRevisionModel({ project: task.project, operation: task.operation, facts: task.facts,
  generationRules: currentSkillSet(task.project).skills['script-revision'].constraints, reviewRules: currentSkillSet(task.project).skills['script-revision'].review })
const parts = (task, kind) => generationParts({ ...task, stage: 'script-revision', kind })
export default {
  generate: task => model(task).generate(parts(task, 'generate')),
  revise: (task, content, review) => model(task).revise(content, review, parts(task, 'revise')),
  review: (task, content) => model(task).review(content, reviewParts({ ...task, stage: 'script-revision' }, content)),
}
