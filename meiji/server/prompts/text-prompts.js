// 文本请求分发与序列化。角色内容、顺序和 JSON 模式由 interfaces/<skill>.js 决定。
// task：{ skill: 阶段技能 ID, project, instructions, reviewInstructions, opinion, reviewContext, mode（文本分镜模式）, modify（按人工意见修改）}
import { isSkill } from '../../skills/load.js'
import { continuityReviewContext } from './continuity-review.js'
import { render, stageMeta } from './skill-prompts.js'
import { textInterface } from './interfaces/registry.js'

function message(stage, { system = [], user = [], json = false }) {
  return { skill: stage, json, system: render(system), user: render(user), segments: { system, user } }
}

export function buildGenerationPrompt(task) {
  return message(task.skill, textInterface(task.skill).generate(task))
}

export function buildReviewPrompt(task, content) {
  // skill 记为 review：执行器与日志据此区分审核请求；stage 为所审阶段。
  return { ...message(task.skill, textInterface(task.skill).review(task, content)), skill: 'review', stage: task.skill }
}

export function buildRevisionPrompt(task, content, review) {
  return message(task.skill, textInterface(task.skill).revise(task, content, review))
}

export function buildTextPrompts(task) {
  return {
    generation: buildGenerationPrompt(task),
    review: (content, revision = {}) => buildReviewPrompt({ ...task, instructions: task.reviewInstructions || task.instructions, ...revision }, content),
    revision: (content, review) => buildRevisionPrompt(task, content, review),
  }
}

// 人工编辑后的审核。stage 为阶段技能 ID（storyboard / outline）或审核范围说明（按剧情整包的验收标准审核）。
export function buildEditedContentReview({ project, stage, shotId }, text) {
  const skill = isSkill(stage) ? stage : 'outline'
  const shot = project.shots?.items.find(item => item.id === shotId)
  return buildReviewPrompt({ project, skill,
    instructions: `只审核已编辑原文，不生成或改写内容。\n审核范围：${isSkill(stage) ? stageMeta(stage).label : stage}\n本集摘要：${project.summary.content}\n大纲：${project.plot.outline.content || ''}${stage === 'text-shot' ? `\n【本镜已通过每秒指令】\n${shot?.seconds.content || ''}` : ''}`,
    reviewContext: continuityReviewContext(project, shotId),
  }, text)
}
