const terminal = status => ['completed', 'failed', 'review_failed', 'cancelled'].includes(status)
const sameRef = (left, right) => left?.id === right.id && left.revision === right.revision
const blockCode = status => `meiji-panel-${status.replaceAll('_', '-')}`

// 面板目标由业务结果结算；round-driver 不再重复调用业务工具。
export function createPanelGoals({ goals, resolveAgent, findOperation }) {
  const turns = new WeakMap()
  function settle(agent, ref, operation) {
    const current = goals.get(agent)
    if (!sameRef(current, ref) || !terminal(operation.status)) return
    if (operation.status === 'completed') return goals.complete(agent, ref)
    return goals.block(agent, ref, {
      code: blockCode(operation.status),
      message: `本次面板操作${operation.status === 'cancelled' ? '已取消' : '未完成'}：${operation.error || operation.failures?.join('；') || operation.status}。停止续跑，仅汇报结果。`,
    })
  }
  async function reconcile(agent) {
    const current = goals.get(agent)
    if (!current || current.phase === 'complete') return
    const operation = await findOperation(agent.id, current.id)
    if (operation?.endedAt) settle(agent, operation.goalRef, operation)
    return operation
  }
  return {
    reconcile,
    beforeStep({ agent, messages, turn }) {
      const panelNotice = message => message.source?.kind === 'tool-jobs' && message.source.summary?.startsWith('meiji 面板单次操作 ')
      const previous = turns.get(agent)
      if (previous?.turn !== turn) turns.set(agent, { turn, panelOnly: messages.length > 0 && messages.every(panelNotice) })
      else if (messages.some(message => !panelNotice(message))) previous.panelOnly = false
    },
    guard(exec) {
      if (turns.get(exec.agent)?.panelOnly && !['job_output', 'meiji_context_query', 'get_goal'].includes(exec.name)) {
        return '本轮仅处理面板单次操作的完成通知，目标已由业务结果结算。只可查询 job_output、meiji_context_query、get_goal，随后汇报并 end；不要更新目标、写计划、重试或启动后续制作。'
      }
    },
    async begin(agent, operation) {
      const previous = await reconcile(agent)
      const current = goals.get(agent)
      if (current && current.phase !== 'complete') {
        // 只清理本适配器结算的旧目标；人工编辑、暂停或其他目标不被覆盖。
        if (previous?.endedAt && terminal(previous.status) && current.id === previous.goalRef.id
          && current.revision === previous.goalRef.revision + 1 && current.phase === 'blocked'
          && current.blockedReason?.code === blockCode(previous.status)) goals.clear(agent, current)
        else throw Object.assign(new Error('当前会话已有未完成的目标，请先处理该目标或新建会话'), { status: 409, code: 'GOAL_ALREADY_EXISTS' })
      }
      const scope = Object.fromEntries(['action', 'projectId', 'episodeId', 'mode', 'generationMode', 'draft', 'only', 'parts', 'itemId', 'track'].filter(key => operation[key] !== undefined).map(key => [key, operation[key]]))
      const created = goals.create(agent, { objective: `仅完成这次面板操作：${JSON.stringify(scope)}。业务引擎负责执行必要前置和回写，不重复发起操作，不扩展其他制作步骤。以该操作的真实终态为准：成功后完成目标；失败或取消则停止目标续跑。读取 job 结果，简短汇报后 end。` })
      goals.disarm(agent)
      const ref = { id: created.id, revision: created.revision }
      return {
        ref,
        async finish(result) {
          const resolved = await resolveAgent(operation.sessionId)
          if (!resolved?.agent) throw new Error('无法恢复会话以结算面板目标')
          return settle(resolved.agent, ref, result)
        },
        discard() {
          const latest = goals.get(agent)
          if (sameRef(latest, ref) || (latest?.id === ref.id && latest.revision === ref.revision + 1 && latest.phase === 'blocked' && latest.blockedReason?.code.startsWith('meiji-panel-'))) goals.clear(agent, latest)
        },
      }
    },
  }
}
