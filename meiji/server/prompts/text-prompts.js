// 文本阶段的请求：生成、按人工意见修改、审核、自动修订。技能内容按请求类型组装（见 skill-prompts.js）。
// task：{ skill: 阶段技能 ID, project, instructions, reviewInstructions, opinion, reviewContext, mode（文本分镜模式）, modify（按人工意见修改）}
import { checkContext } from '../data/operation-context.js'
import { isSkill } from '../../skills/load.js'
import { continuityReviewContext } from './continuity-review.js'
import { generationSystem, generationUser, render, reviewSystem, reviewUser, stageMeta } from './skill-prompts.js'

function message(stage, system, user) {
  return { skill: stage, json: stageMeta(stage).output === 'json', system: render(system), user: render(user), segments: { system, user } }
}

export function buildGenerationPrompt({ skill, project, instructions, opinion = '', mode = '', modify = false, skillSet }) {
  return message(skill,
    generationSystem({ stage: skill, project, mode, kind: modify ? 'modify' : 'generate', skillSet }),
    generationUser({ stage: skill, project, instructions, opinion, skillSet }))
}

export function buildReviewPrompt(task, content) {
  const args = { ...task, stage: task.skill }
  // skill 记为 review：执行器与日志据此区分审核请求；stage 为所审阶段。
  return { ...message(task.skill, reviewSystem(args), reviewUser(args, content)), skill: 'review', stage: task.skill, json: false }
}

export function buildRevisionPrompt(task, content, review) {
  const instructions = `${task.reviewInstructions || task.instructions}\n【本轮定向修订】\n最新失败稿（以此为唯一修改基准）：\n${content}\n本轮自审不通过原因：\n${review}\n保留原人工意见，只修改受影响内容及必要衔接。返回完整修订结果，不返回修改说明。`
  return message(task.skill,
    generationSystem({ stage: task.skill, project: task.project, mode: task.mode, kind: 'revise', skillSet: task.skillSet }),
    generationUser({ ...task, stage: task.skill, instructions }))
}

export function buildTextPrompts(task) {
  const requirements = checkContext.getStore()?.requirements
  if (requirements) {
    const addition = `\n【本次生成要求】\n${requirements}`
    task = { ...task, instructions: task.instructions + addition, reviewInstructions: (task.reviewInstructions || task.instructions) + addition }
  }
  return {
    generation: buildGenerationPrompt(task),
    review: content => buildReviewPrompt({ ...task, instructions: task.reviewInstructions || task.instructions }, content),
    revision: (content, review) => buildRevisionPrompt(task, content, review),
  }
}

// 人工编辑后的审核。stage 为阶段技能 ID（storyboard / outline）或审核范围说明（按剧情整包的验收标准审核）。
export function buildEditedContentReview({ project, stage, shotId }, text) {
  const skill = isSkill(stage) ? stage : 'outline'
  return buildReviewPrompt({ project, skill,
    instructions: `只审核已编辑原文，不生成或改写内容。\n审核范围：${isSkill(stage) ? stageMeta(stage).label : stage}\n本集摘要：${project.summary.content}\n大纲：${project.plot.outline.content || ''}`,
    reviewContext: continuityReviewContext(project, shotId),
  }, text)
}
