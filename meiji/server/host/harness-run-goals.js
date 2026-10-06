// 会话目标只绑定制作任务；暂停保持进行中，终态由业务结果结算。
export function createHarnessRunGoals({ goals, resolveAgent, saveBinding, readBinding }) {
  const attached = new Map(), pending = new Map()
  const key = run => `${run.projectId}:${run.id}`
  const same = (goal, ref) => goal?.id === ref.id && goal.revision === ref.revision
  return {
    async attach(run, sessionId) {
      const { agent } = await resolveAgent(sessionId)
      if (!agent) throw new Error('无法关联制作任务的会话目标')
      const saved = await readBinding(run.projectId, run.id), existing = saved.goalRef
      let current = goals.get(agent)
      if (existing && same(current, existing)) {
        goals.disarm(agent); attached.set(key(run), { ref: existing, sessionId }); return existing
      }
      if (current && current.phase !== 'complete') throw Object.assign(new Error('会话已有其他未完成目标，请先处理该目标'), { status: 409, code: 'GOAL_ALREADY_EXISTS' })
      current = goals.create(agent, { objective: `完成制作任务 ${run.id}：${JSON.stringify(run.goal)}。由 Run 引擎执行；暂停时汇报所需处理，不自行扩展或重试。` })
      goals.disarm(agent)
      const ref = { id: current.id, revision: current.revision }
      try { await saveBinding(run.projectId, run.id, { goalRef: ref, goalSessionId: sessionId }) }
      catch (error) { if (same(goals.get(agent), ref)) goals.clear(agent, ref); throw error }
      attached.set(key(run), { ref, sessionId }); return ref
    },
    observe(run) {
      const binding = attached.get(key(run)) || (run.goalRef && { ref: run.goalRef, sessionId: run.goalSessionId })
      if (!binding || !['completed', 'cancelled'].includes(run.status)) return
      const previous = pending.get(key(run)) || Promise.resolve()
      const settlement = previous.then(async () => {
        const { agent } = await resolveAgent(binding.sessionId)
        if (!agent || !same(goals.get(agent), binding.ref)) return
        if (run.status === 'completed') goals.complete(agent, binding.ref)
        else goals.block(agent, binding.ref, { code: 'meiji-run-cancelled', message: `制作任务 ${run.id} 已取消` })
        attached.delete(key(run))
      })
      pending.set(key(run), settlement)
      settlement.catch(() => {})
    },
    async drain() { await Promise.all(pending.values()) },
  }
}
