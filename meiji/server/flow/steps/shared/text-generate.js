import { runNode } from '../../../runtime/step-execution.js'
import { runTextRequest } from '../../../gateway/model-gateway.js'
import { activeNode } from '../../../runtime/task-context.js'

export async function generateStep({ kind = 'generate', target = null, phase, label, round, message, options, complete, persist }) {
  return runNode(kind, async () => {
    let text = await runTextRequest(message, options)
    if (!String(text || '').trim()) throw new Error('模型未返回内容')
    if (complete) text = await complete(text, message, options)
    if (persist && await persist(text, { passed: null, failures: [] }) !== false) markSaved()
    return text
  }, { target, phase, label, round })
}

function markSaved() {
  const step = activeNode()
  if (step) step.saved = true
}

