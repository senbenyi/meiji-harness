// 操作上下文：一次操作执行期间共享的审核信息（意见、目标、校验结果、原始内容等）。
// 执行状态不再放在这里，而是从当前任务的步骤推导：
//   是否处在文本步骤中（保存的是草稿、推迟报告自检失败）、是否发生接口失败、是否已保存草稿。
import { AsyncLocalStorage } from 'node:async_hooks'
import { activeNode, executionNodes } from './task-context.js'

export const checkContext = new AsyncLocalStorage()

const textKinds = new Set(['generate', 'revise', 'review', 're_review'])

// 标记接口失败：记在错误与当前步骤上（中止不算接口失败）；不在步骤中时只记在错误上，由操作结束时的失败原因判断。
export function markApiFailure(error) {
  const context = checkContext.getStore()
  if (context?.signal?.aborted || error.name === 'AbortError') return error
  error.apiFailure = true
  const step = activeNode()
  if (step) step.apiFailure = true
  return error
}

// 本操作的步骤中是否发生过接口失败。
export const apiFailed = () => executionNodes().some(step => step.apiFailure)

// 当前是否处在生成、修订或审核步骤中。
export const inTextNode = () => textKinds.has(activeNode()?.kind)
