import { jsonOutput, sessionIdOf } from './session-context-query-tool.js'
export function taskControlTool({ tasks }) {
  return {
    name: 'meiji_task_control',
    description: '查询、等待或停止当前会话发起的任务。wait 最多等待25秒；仍为 queued（排队中）或 running 时继续 wait，不重新发起生成。completed 且 reviewPassed=true 才可更新计划为完成并继续依赖步骤。review_failed、failed、cancelled 时停止依赖步骤，报告原因；服务重启会取消进行中任务（记为 cancelled），重启后仍可查询持久化任务记录；已取消的任务不自动重做，需要时按用户要求重新发起。',
    parameters: { type: 'object', additionalProperties: false, required: ['action', 'taskId'], properties: {
      action: { type: 'string', enum: ['get', 'wait', 'cancel'] }, taskId: { type: 'string' },
    } }, output: jsonOutput,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec), task = await tasks.get(args.taskId, sessionId)
      if (args.action === 'wait') return JSON.stringify(await tasks.wait(args.taskId, sessionId, exec.signal))
      if (args.action === 'cancel') tasks.cancel(args.taskId, task.projectId)
      else if (args.action !== 'get') throw new Error('任务操作无效')
      return JSON.stringify(await tasks.get(args.taskId, sessionId))
    },
  }
}
