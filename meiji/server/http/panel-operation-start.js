// 生成的面板入口：恢复公开会话 Agent 后登记 jobs；恢复/登记失败不影响生成。
export async function startPanelOperation({ ctx, manager, jobs, operation }) {
  if (operation.draft || operation.action === 'script-sync') {
    const started = manager.start(operation, ctx.sessions.get(operation.sessionId))
    await started.ready; return { status: 'running', operationId: started.id }
  }
  if (jobs) {
    try {
      const resolved = await ctx.sessionController.resolveAgent(operation.sessionId)
      if (!resolved?.agent) throw new Error(resolved?.error?.message || '无法恢复当前会话')
    } catch (error) {
      ctx.logger.warn(`生成继续执行，后台任务未登记：${error.message}`)
      const started = manager.start(operation, ctx.sessions.get(operation.sessionId)); await started.ready
      return { status: 'running', operationId: started.id, warning: error.message }
    }
    try { return await jobs.start(operation, ctx.sessions.get(operation.sessionId)) }
    catch (error) {
      if (error.code !== 'JOBS_UNAVAILABLE') throw error
      ctx.logger.warn(`生成继续执行，后台任务未登记：${error.message}`)
    }
  }
  const started = manager.start(operation, ctx.sessions.get(operation.sessionId)); await started.ready
  return { status: 'running', operationId: started.id }
}
