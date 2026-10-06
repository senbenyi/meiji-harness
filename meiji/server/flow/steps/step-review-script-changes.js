import { reviewStep } from './shared/text-review.js'

// 任务传入按允许修改目标校验的 check；本步骤不提交或创建方案。
export const reviewScriptChanges = input => reviewStep({ ...input, message: input.prompts.review(input.text, input.revision) })
