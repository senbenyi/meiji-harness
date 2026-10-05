// 面板目标与业务操作一一对应；job 观察并在目标结算后通知会话。
export async function startPanelOperation({ ctx, manager, jobs, panelGoals, operation }) {
  const resolved = await ctx.sessionController.resolveAgent(operation.sessionId)
  if (!resolved?.agent) throw new Error(resolved?.error?.message || '无法恢复当前会话')
  const goal = await panelGoals.begin(resolved.agent, operation)
  operation = { ...operation, goalRef: goal.ref }
  try {
    if (jobs) {
      try { return { ...await jobs.start(operation, ctx.sessions.get(operation.sessionId), {}, goal.finish), goalId: goal.ref.id } }
      catch (error) {
        if (error.code !== 'JOBS_UNAVAILABLE') throw error
        ctx.logger.warn(`生成继续执行，后台任务未登记：${error.message}`)
      }
    }
    const started = manager.start(operation, ctx.sessions.get(operation.sessionId))
    manager.whenEnded(started.id, { projectId: operation.projectId }).then(goal.finish).catch(error => ctx.logger.warn(`面板目标结算失败：${error.message}`))
    await started.ready
    return { status: 'running', operationId: started.id, goalId: goal.ref.id }
  } catch (error) {
    goal.discard()
    throw error
  }
}
