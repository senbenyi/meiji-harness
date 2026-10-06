import { reviseStep } from './shared/text-revise.js'

// 定向修改使用任务保存的当前基稿；自动修订使用本轮失败稿及审核问题。
export function reviseShotTable(input) {
  const message = input.round
    ? input.prompts.revision(input.baseContent, input.revisionOpinion)
    : input.prompts.generation
  return reviseStep({ ...input, message })
}
