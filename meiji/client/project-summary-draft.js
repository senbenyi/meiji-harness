import { request, jsonBody } from './panel-api.js'
import { currentSessionId } from './chat-bridge.js'

// 创建前的剧本摘要也走独立任务；取消只停止本地执行，不创建项目。
export async function generateProjectSummaryDraft(scriptAssetId, { signal, onTask }) {
  const sessionId = currentSessionId()
  if (!sessionId) throw new Error('没有打开的会话，无法关联任务日志')
  let operationId
  const cancel = () => operationId && request('operations/cancel', { method: 'POST', ...jsonBody({ sessionId, operationId }) }).catch(() => {})
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const started = await request('turn', { method: 'POST', ...jsonBody({ action: 'project-summary', draft: true, scriptAssetId, sessionId }) })
    operationId = started.operationId
    if (signal.aborted) { await cancel(); signal.throwIfAborted() }
    while (true) {
      const { operation } = await request(`operations/${operationId}?` + new URLSearchParams({ sessionId }), { signal })
      onTask?.(operation, sessionId)
      if (operation.status === 'completed') {
        if (!operation.draft?.summary || operation.draft.check?.passed !== true) throw new Error('任务未返回已通过的项目摘要')
        return { ...operation.draft, operationId, sessionId }
      }
      if (['failed', 'cancelled', 'review_failed'].includes(operation.status)) throw new Error(operation.error || operation.failures?.join('；') || '项目摘要生成未完成')
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 800)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
  } finally { signal.removeEventListener('abort', cancel) }
}
