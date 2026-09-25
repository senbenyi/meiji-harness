import { homedir } from 'node:os'
import { join } from 'node:path'
import { linkStore } from '../server/data/links.js'
import { runOperation, takeOperation, takePendingForSession } from '../server/flow/actions.js'
import { insertSessionLog, runWithSessionLog } from '../server/flow/session-log.js'

const jsonOut = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
const unbound = '当前工作区还没有绑定短剧。请点击工作区名称，从目录里选择一部。'

export function panelTool(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return {
    name: 'meiji_panel',
    description: '执行极乐世界右侧面板送入当前会话的一项操作。面板消息必须传 operationId。没有面板消息时不要传项目编号，项目由当前工作区的绑定决定。执行记录已经写在会话里，不要复述。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operationId: { type: 'string', description: '仅当消息里明确写了操作编号时才传。面板消息必须传' },
        action: { type: 'string', description: '没有操作编号时的动作：open、create、overview、outline、characters、scenes、shots、storyboard、film、use-asset 等' },
        title: { type: 'string', description: '打开短剧时的完整标题，必须与目录中的标题一致' },
        itemId: { type: 'string' },
        instruction: { type: 'string', description: '改形象时的新要求' },
        step: { type: 'string' },
        episodeId: { type: 'string', description: '制作操作所属的剧集 ID；多集项目必须指定' },
        track: { type: 'string' },
        review: { type: 'string' },
        slot: { type: 'string' },
        assetId: { type: 'string' },
        category: { type: 'string' },
      },
      required: [],
    },
    output: jsonOut,
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.id || ''
      let operation
      const staged = args.operationId ? takeOperation(args.operationId, sessionId) : takePendingForSession(sessionId)
      if (staged) {
        operation = staged.sessionId ? staged : { ...staged, sessionId }
      } else if (args.action === 'create' || args.action === 'library-import' || args.action === 'open') {
        operation = { action: args.action, title: args.title, sessionId }
      } else {
        const place = await linkStore(home).projectForSession(sessionId)
        if (!place.projectId) throw new Error(unbound)
        operation = { action: args.action, itemId: args.itemId, instruction: args.instruction, step: args.step, episodeId: args.episodeId, track: args.track, review: args.review, slot: args.slot, assetId: args.assetId, category: args.category, sessionId, projectId: place.projectId }
      }
      const session = exec?.agent?.session
      return runWithSessionLog(session, async () => {
        try {
          const trace = await runOperation(operation, { home, workspaceController: ctx.workspaceController, session })
          try { insertSessionLog(session, trace.join('\n')) } catch { /* 日志写不进会话时，操作结果仍然有效 */ }
          return trace.status === 'running'
            ? '已提交，后台生成中，尚未完成。到此停止，不要自动重试或进入下一步。'
            : '本次操作已执行，审核是否通过以会话执行记录和面板状态为准。到此停止，不要自动重试或进入下一步。'
        } catch (error) {
          try { insertSessionLog(session, error?.message || '操作失败', true) } catch { /* 同上 */ }
          throw error
        }
      })
    },
  }
}
