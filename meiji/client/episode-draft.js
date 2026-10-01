import { request, jsonBody } from './api.js'
import { currentSessionId } from './chat-bridge.js'

// 使用现有任务队列、查询与停止接口；关闭弹框也停止排队/执行中的任务。
export async function generateEpisodeDraft(project, input, { signal }) {
  const sessionId = currentSessionId()
  if (!sessionId) throw new Error('没有打开的会话，无法关联任务日志')
  let operationId
  const cancel = () => operationId && request('tasks', { method: 'POST', ...jsonBody({ projectId: project.id, sessionId, operationId }) }).catch(() => {})
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const started = await request('turn', { method: 'POST', ...jsonBody({ action: 'episode-summary-draft', projectId: project.id, sessionId, ...input }) })
    operationId = started.operationId
    if (signal.aborted) { await cancel(); signal.throwIfAborted() }
    while (true) {
      const { task } = await request('tasks?' + new URLSearchParams({ projectId: project.id, sessionId, operationId }), { signal })
      if (task.status === 'completed') {
        if (!task.draft) throw new Error('任务未返回摘要草稿')
        return task.draft
      }
      if (['failed', 'cancelled', 'review_failed'].includes(task.status)) throw Object.assign(new Error(task.error || task.failures?.join('；') || '摘要生成未完成'), { draft: task.draft })
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 800)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
  } finally { signal.removeEventListener('abort', cancel) }
}
