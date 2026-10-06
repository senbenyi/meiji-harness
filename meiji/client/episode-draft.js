import { request, jsonBody } from './panel-api.js'
import { currentSessionId } from './chat-bridge.js'
import { goalRequest } from './goal-request.js'
import { confirmRunPreview } from './run-preview.js'

// 使用现有任务队列、查询与停止接口；关闭弹框也停止排队/执行中的任务。
export async function generateEpisodeDraft(project, input, { signal, onTask }) {
  const sessionId = currentSessionId()
  if (!sessionId) throw new Error('没有打开的会话，无法关联任务日志')
  let runId
  const scope = { projectId: project.id, sessionId }
  const cancel = () => runId && request(`runs/${runId}/cancel`, { method: 'POST', ...jsonBody(scope) }).catch(() => {})
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const planned = await request('runs', { method: 'POST', ...jsonBody({ ...scope, ...goalRequest('episode-summary-draft', input) }) })
    runId = planned.run.id
    if (planned.amend) throw new Error('当前摘要草稿仍在执行，请先处理该任务')
    const accepted = await confirmRunPreview(document.querySelector('meiji-workbench')?.shadowRoot?.querySelector('.content') || document.body, planned, {
      refresh: authorizePrereq => request(`runs/${runId}/preview`, { method: 'POST', ...jsonBody({ ...scope, authorizePrereq }) }),
    })
    if (!accepted) { await cancel(); throw new Error('已取消摘要生成') }
    await request(`runs/${runId}/confirm`, { method: 'POST', ...jsonBody({ ...scope, ...accepted }) })
    if (signal.aborted) { await cancel(); signal.throwIfAborted() }
    while (true) {
      const { run: task } = await request(`runs/${runId}?` + new URLSearchParams(scope), { signal })
      onTask?.(task)
      if (task.status === 'completed') {
        const draft = task.steps.findLast(step => ['generate', 'revise'].includes(step.kind))?.output?.result?.draft
        if (!draft) throw new Error('任务未返回摘要草稿')
        return draft
      }
      if (['paused', 'cancelled'].includes(task.status)) throw new Error(task.pause?.reasons.map(reason => reason.message).join('；') || '摘要生成未完成')
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 800)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
  } finally { signal.removeEventListener('abort', cancel) }
}
