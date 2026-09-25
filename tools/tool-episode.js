import { homedir } from 'node:os'
import { join } from 'node:path'
import { linkStore } from '../server/data/links.js'
import { runOperation, takeOperation, takePendingForSession } from '../server/flow/actions.js'
import { insertSessionLog, runWithSessionLog } from '../server/flow/session-log.js'

const jsonOut = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
const unbound = '当前工作区还没有绑定短剧。请点击工作区名称，从目录里选择一部。'

export function episodeTool(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return {
    name: 'meiji_episode',
    description: '为当前工作区绑定的短剧生成下一集，或按面板指定的 episodeId 重新生成本集摘要。第 1 集根据项目摘要写，单集不超过 180 秒。面板消息必须传 operationId。执行记录已经写在会话里，不要复述。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { operationId: { type: 'string' } },
      required: [],
    },
    output: jsonOut,
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.id || ''
      const staged = args.operationId ? takeOperation(args.operationId, sessionId, 'episode-generate') : takePendingForSession(sessionId)
      let operation = staged ? (staged.sessionId ? staged : { ...staged, sessionId }) : null
      if (!operation) {
        const place = await linkStore(home).projectForSession(sessionId)
        if (!place.projectId) throw new Error(unbound)
        operation = { action: 'episode-generate', sessionId, projectId: place.projectId }
      }
      const session = exec?.agent?.session
      return runWithSessionLog(session, async () => {
        try {
          const trace = await runOperation(operation, {
            home,
            session,
          })
          try { insertSessionLog(session, trace.join('\n')) } catch { /* 日志写不进会话时，操作结果仍然有效 */ }
        } catch (error) {
          try { insertSessionLog(session, error?.message || '操作失败', true) } catch { /* 同上 */ }
          throw error
        }
        return '已完成。'
      })
    },
  }
}
