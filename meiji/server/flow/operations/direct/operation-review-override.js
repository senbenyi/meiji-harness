// 操作：忽略自审并通过
import { GenerationStatus } from '../../../models/data/drama-model.js'
import { runNode } from '../../../runtime/step-execution.js'
import { targetNode } from '../../../models/data/drama-model.js'
import { overrideBlocker, overrideNodes } from '../../../../shared/review-feedback.js'
import { markPassed } from '../../../models/tasks/content-state.js'

// if (operation.action === 'review-override')
// 人工忽略自审：新任务，只含一个 override 步骤（执行者为人），把当前版本的不通过改为通过并保留原 AI 理由；原任务不变。
export async function opReviewOverride(c) {
  let { operation, projects, project, trace, note } = c
  const key = String(operation.key || '')
  const blocked = overrideBlocker(project, key)
  if (blocked) throw Object.assign(new Error(blocked), { status: 409 })
  await runNode('override', async () => {
    await projects.save(project.id, current => {
      const reason = overrideBlocker(current, key)
      if (reason) throw Object.assign(new Error(reason), { status: 409 })
      const next = structuredClone(current), at = new Date().toISOString()
      for (const [item] of overrideNodes(next, key)) {
        const target = targetNode(next, item)
        markPassed(target, { override: { at, actor: 'human', reasons: target.check.failures || [] } })
      }
      return next
    })
    return { check: { passed: true, failures: [] } }
  }, { target: key })
  note(`已忽略自审并放行：${key}`)
  return trace
}

export const operations = {
  'review-override': { label: '忽略自审并通过', scope: 'episode', agent: false, plan: (_, op) => [{ kind: 'override', target: op.key }], stage: 'episode', run: opReviewOverride },
}
