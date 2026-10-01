// 可选的操作上下文工具。由各文本接口主动调用，分发器不注入任何提示词。
import { checkContext } from '../../data/operation-context.js'

export function withRequirements(task) {
  const requirements = checkContext.getStore()?.requirements
  if (!requirements) return task
  const addition = `\n【本次生成要求】\n${requirements}`
  return { ...task, instructions: task.instructions + addition, reviewInstructions: (task.reviewInstructions || task.instructions) + addition }
}

export function revisionTask(task, content, review) {
  return { ...task, instructions: task.reviewInstructions || task.instructions,
    baseContent: content, opinion: review, humanOpinion: task.opinion || '', automatic: true }
}
