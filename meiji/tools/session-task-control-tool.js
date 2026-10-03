import { currentProject, jsonOutput, sessionIdOf } from './session-context-query-tool.js'
import { cancelOperation } from '../server/flow/operations/operation-cancel.js'

// 会话不提供查看任务的入口（任务、步骤、提示词与历史只在面板查看），只返回续跑所需的最小结果。
const minimal = result => ({ operationId: result.operationId || result.id, projectId: result.projectId, episodeId: result.episodeId,
  status: result.status, reviewPassed: result.reviewPassed ?? null, failures: result.failures || [], ...(result.error ? { error: result.error } : {}), ...(result.occupant ? { occupant: true } : {}) })

export function taskControlTool({ home, tasks }) {
  return {
    name: 'meiji_task_control',
    description: '等待或停止当前会话发起的操作（operationId 来自 meiji_content_generate）。生成返回 busy 时，可 wait 其中的 operationId（占用本集的其他操作，可能由面板发起）直到结束，但不能停止它。wait 最多等待25秒；仍为 queued（排队中）或 running 时继续 wait，不重新发起生成。completed 且 reviewPassed=true 才可更新计划为完成并继续依赖步骤。review_failed、failed、cancelled 时停止依赖步骤，报告 failures 中的原因；服务重启会取消进行中操作（记为 cancelled），已取消的操作不自动重做，需由用户决定是否重新发起。任务与步骤详情只在面板查看。',
    parameters: { type: 'object', additionalProperties: false, required: ['action', 'operationId'], properties: {
      action: { type: 'string', enum: ['wait', 'cancel'] }, operationId: { type: 'string' },
    } }, output: jsonOutput,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      if (args.action === 'wait') {
        try { return JSON.stringify(minimal(await tasks.wait(args.operationId, sessionId, exec.signal))) }
        catch (error) {
          if (error.status !== 404) throw error
          // 非本会话发起的操作：只允许等待当前项目中占用剧集的操作（生成返回 busy 时给出）。
          return JSON.stringify(minimal(await tasks.waitOccupant(args.operationId, exec.signal, { projectId: (await currentProject(home, exec)).id })))
        }
      }
      if (args.action !== 'cancel') throw new Error('操作无效')
      const current = await tasks.get(args.operationId, sessionId)
      cancelOperation(tasks, { id: args.operationId, projectId: current.projectId, sessionId, initiator: 'session' })
      return JSON.stringify({ operationId: current.operationId || current.id, accepted: true })
    },
  }
}
