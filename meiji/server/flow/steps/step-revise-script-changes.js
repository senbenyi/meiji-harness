import { reviseStep } from './shared/text-revise.js'

// 仅修订本轮方案；提交、版本校验与人工确认仍由剧本任务负责。
export const reviseScriptChanges = input => reviseStep({ ...input, message: input.prompts.revision(input.baseContent, input.revisionOpinion) })
