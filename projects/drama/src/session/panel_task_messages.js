import { randomUUID } from 'node:crypto'

const labels = { completed: '已完成', rejected: '未通过', failed: '执行失败', cancelled: '已取消' }

/** 面板展示只追加log-only事件，不使用followup/inject或请求模型。 */
export function createPanelTaskDisplay(ctx, projects) {
  return async (report, phase, name) => {
    const creating = report.node_type === 'project' && report.action === 'create'
    const sessionId = phase === 'start' && creating ? report.source_session_id : report.session_id
    if (!sessionId) throw new Error('面板展示缺少项目已有会话')
    if (!(phase === 'start' && creating)) {
      const snapshot = await projects.snapshot(sessionId)
      if (!snapshot.project || snapshot.project.basic_info.id !== report.project_id) throw new Error('面板展示目标项目已删除或会话归属改变')
    }
    const { agent } = await ctx.sessionController.resolveAgent(sessionId)
    const session = agent?.session
    if (typeof session?.append !== 'function') throw new Error('接收会话不可用，面板消息保持待投递')
    const id = randomUUID()
    const status = phase === 'start' ? '已受理' : labels[report.status] || report.status
    const text = [phase === 'start' ? `面板操作：${name}` : `${name}：${status}`,
      report.goal ? `要求：${report.goal}` : '', phase === 'result' ? [report.summary, report.reason, report.warning].filter(Boolean).join('\n') : ''].filter(Boolean).join('\n')
    await session.append('command/run', { commandId: id, name: phase === 'start' ? '面板操作' : '任务结果', args: text, source: { kind: 'user' } })
    await session.append('command/done', { commandId: id,
      kind: phase === 'result' && ['failed', 'rejected'].includes(report.status) ? 'error' : 'success', text: text + '\n' })
  }
}
