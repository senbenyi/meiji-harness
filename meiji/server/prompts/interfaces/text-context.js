// 可选的操作上下文工具。由各文本接口主动调用，分发器不注入任何提示词。
import { checkContext } from '../../data/operation-context.js'

export function withRequirements(task) {
  const requirements = checkContext.getStore()?.requirements
  if (!requirements) return task
  const addition = `\n【本次生成要求】\n${requirements}`
  return { ...task, instructions: task.instructions + addition, reviewInstructions: (task.reviewInstructions || task.instructions) + addition }
}

export function revisionTask(task, content, review) {
  const instructions = `${task.reviewInstructions || task.instructions}\n【本轮定向修订】\n最新失败稿（以此为唯一修改基准）：\n${content}\n本轮自审不通过原因：\n${review}\n保留原人工意见，只修改受影响内容及必要衔接。返回完整修订结果，不返回修改说明。`
  return { ...task, instructions }
}
