import { createHash } from 'node:crypto'
import { displayContext, compactDisplay } from './task_display_context.js'
import { taskHistoryPresentation } from '../client/ui/task-presentation.js'

const labels = { completed: '已完成', rejected: '未通过', failed: '执行失败', cancelled: '已取消', done: '已完成', skipped: '已跳过' }
const marker = 'drama-task-display'

/** 创建尚未产生项目会话时，消息归发起会话；已创建后归项目会话。 */
export async function reportSession(projects, report, phase) {
  const creating = report.node_type === 'project' && report.action === 'create'
  const beforeCreated = creating && (phase === 'start' || !report.result?.session_id)
  const sessionId = beforeCreated ? report.source_session_id : report.session_id
  if (!sessionId) throw new Error('任务展示缺少项目已有会话')
  if (!beforeCreated) {
    const snapshot = await projects.snapshot(sessionId)
    if (!snapshot.project || snapshot.project.basic_info.id !== report.project_id) throw new Error('报告目标项目已删除或会话归属改变')
  }
  return sessionId
}

export function taskDisplayCard(report, phase, name, step, context = {}) {
  const review = step ? taskHistoryPresentation.review(step) : {}
  const status = phase === 'start' ? 'accepted' : review.rejected ? 'rejected' : step?.step_status || report.status
  const title = phase === 'start' ? name : step ? `${name} · ${step.seq}. ${step.name}${step.round ? `（第${step.round}轮）` : ''}` : name
  const reason = step ? [step.error_reason, review.reason].filter(Boolean).join('\n') : [report.reason, report.warning].filter(Boolean).join('\n')
  return { ...compactDisplay(context), kind: marker, phase, group_id: report.group_id, task_id: step?.task_id || report.task_id,
    ...(step ? { step_id: step.id, round: step.round, seq: step.seq } : {}),
    title, status, label: phase === 'start' ? '已受理' : labels[status] || status,
    goal: report.goal || '', reason,
    ...(review.rejected ? { issue_summary: step.result.review.issues?.[0]?.reason || '' } : {}),
    ...(phase === 'result' ? { saved: Boolean(report.saved), stopped_at: report.stopped_at || context.stopped_at || '', reason: reason || (report.status === 'completed' ? report.saved ? report.node_type === 'script_revision' ? '审核通过，当前工作稿已更新。' : '操作完成，结果已保存。' : '操作已完成。' : '执行已停止。') } : {}),
    ...(step ? { result: structuredClone(step.result) } : {}),
  }
}

/** 只追加log-only事件；固定ID及逐事件去重支持崩溃恢复，不请求模型。 */
export function createPanelTaskDisplay(ctx, projects) {
  const queues = new Map()
  const display = async (report, phase, name, step) => {
    const sessionId = await reportSession(projects, report, phase)
    const prior = queues.get(sessionId) || Promise.resolve()
    const pending = prior.catch(() => {}).then(async () => {
      const { agent } = await ctx.sessionController.resolveAgent(sessionId)
      const session = agent?.session
      if (typeof session?.append !== 'function' || typeof session.snapshotEvents !== 'function') throw new Error('接收会话不可用，任务消息保持待投递')
      const id = createHash('sha256').update(JSON.stringify([marker, report.group_id, step?.task_id || report.task_id, phase, step?.id || null, step?.round ?? null])).digest('hex')
      const detail = projects.records?.tasks.detail(projects.records.scope, report.group_id)
      const task = detail?.tasks.find(task => task.id === (step?.task_id || report.task_id))
      const card = taskDisplayCard(report, phase, name, step, task ? displayContext(detail, task, step) : {})
      const text = [`${card.title}：${card.label}`, card.goal ? `要求：${card.goal}` : '', phase === 'result' && card.stopped_at ? `结束步骤：${card.stopped_at}` : '',
        card.input_description ? `输入：${card.input_description.origin}${card.input_description.characters !== undefined ? ` · ${card.input_description.characters}字` : ''}` : '',
        card.reason, step ? `步骤结果：\n${JSON.stringify(step.result, null, 2)}` : ''].filter(Boolean).join('\n')
      const events = session.snapshotEvents()
      if (!events.some(event => event.type === 'command/run' && event.data.commandId === id))
        await session.append('command/run', { commandId: id, name: phase === 'start' ? '面板操作' : step ? '盒子步骤' : '任务结果', args: JSON.stringify(card), source: { kind: 'user' } })
      if (!events.some(event => event.type === 'command/done' && event.data.commandId === id))
        await session.append('command/done', { commandId: id, kind: ['failed', 'rejected'].includes(card.status) ? 'error' : 'success', text: text + '\n' })
      return { message_id: id, session_id: sessionId }
    })
    queues.set(sessionId, pending)
    try { return await pending }
    finally { if (queues.get(sessionId) === pending) queues.delete(sessionId) }
  }
  display.read = async (sessionId, { id, compact = false, eager = false, after = -1, pending = [] } = {}) => {
    const { agent } = await ctx.sessionController.resolveAgent(sessionId)
    const events = agent?.session?.snapshotEvents() || []
    const done = new Map(events.filter(event => event.type === 'command/done').map(event => [event.data.commandId, event.data]))
    const details = new Map()
    const messages = events.filter(event => event.type === 'command/run' && done.has(event.data.commandId) && (!id || event.data.commandId === id)).flatMap(event => {
      try {
        const card = JSON.parse(event.data.args)
        if (card.kind !== marker) return []
        if (!details.has(card.group_id)) details.set(card.group_id, projects.records?.tasks.detail(projects.records.scope, card.group_id))
        const detail = details.get(card.group_id)
        const task = detail?.tasks.find(task => task.id === card.task_id)
        const step = card.step_id ? detail?.steps.find(step => step.id === card.step_id && step.task_id === card.task_id) : undefined
        const enriched = { ...card, ...(task ? displayContext(detail, task, step) : {}), id: event.data.commandId, event_seq: event.seq ?? events.indexOf(event) }
        return [enriched]
      }
      catch {
        if (!['面板操作', '任务结果'].includes(event.data.name)) return []
        const outcome = done.get(event.data.commandId)
        return [{ id: event.data.commandId, event_seq: event.seq ?? events.indexOf(event), title: event.data.name, label: event.data.name === '面板操作' ? '已受理' : outcome.kind === 'error' ? '未通过' : '已完成', status: outcome.kind === 'error' ? 'rejected' : 'completed', reason: outcome.text || event.data.args || '' }]
      }
    })
    if (eager) {
      const pendingGroups = new Set(pending)
      return { messages: messages.map(compactDisplay),
        details: messages.filter(message => message.event_seq > after || (pendingGroups.has(message.group_id) && !['queued', 'running'].includes(message.operation_status))),
        cursor: Math.max(after, ...messages.map(message => message.event_seq)),
      }
    }
    return compact ? messages.map(compactDisplay) : messages
  }
  return display
}
