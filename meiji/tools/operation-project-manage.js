import { projectStore } from '../server/data/project-store.js'
import { linkStore } from '../server/data/workspace-links.js'
import { runWithSessionLog, insertSessionLog } from '../server/host/session-log.js'
import { jsonOutput, sessionIdOf, currentProject } from './operation-context-query.js'
import { createProject } from '../server/flow/project-creation.js'

export function projectManageTool({ home, tasks, jobs, workspaceController }) {
  return {
    name: 'operation-project-manage',
    description: '仅在用户要求创建或明确操作某项目时创建/open 并关联当前会话，不影响其他会话；普通对话无需项目。已绑定项目时禁止 create 或 open 其他项目；无关请求提示「请切换工作区或新建会话」。open 使用 operation-context-query 返回的项目 ID，同名不猜测。create 默认自由模式，必须由用户提供 AI 创作方向 premise；选择剧本模式必须提供剧本或 scriptAssetId，缺资料先询问，不代写创作方向。需要标题、画幅、风格，不生成摘要或剧集。edit-script 提出剧本修改方案等待用户确认。AI 创作方向仅由用户在面板手动编辑，会话只能读取并据此生成剧集摘要。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['create', 'open', 'edit-script'] }, projectId: { type: 'string' },
      text: { type: 'string' }, note: { type: 'string' }, baseRevision: { type: 'integer', minimum: 0 },
      changes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['target', 'before', 'after'], properties: { target: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string', enum: ['body', 'episode', 'future'] }, episodeId: { type: 'string' } } }, before: { type: 'string' }, after: { type: 'string' } } } },
      fields: { type: 'object', additionalProperties: false, required: ['title'], properties: {
        title: { type: 'string' }, mode: { type: 'string', enum: ['free', 'script'], default: 'free' }, premise: { type: 'string', description: '用户亲自提供的 AI 创作方向，自由模式必填，原样保存，不替用户撰写' }, script: { type: 'string' }, scriptAssetId: { type: 'string' }, style: { type: 'string' }, aspectRatio: { type: 'string', enum: ['1344x768', '768x1344'] },
      } },
    } }, output: jsonOutput,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec), store = projectStore(home), links = linkStore(home, workspaceController)
      if (!['create', 'open', 'edit-script'].includes(args.action)) throw new Error('项目操作无效')
      if (args.action === 'edit-script') {
        const current = await currentProject(home, exec)
        const started = tasks.start({ action: 'script-propose', projectId: current.id, sessionId, origin: 'session', callId: exec.callId, text: args.text, changes: args.changes, note: args.note, baseRevision: args.baseRevision }, exec.agent.session)
        const result = await started.done
        if (started.failure) throw started.failure
        return JSON.stringify({ status: result.status, projectId: current.id, ...result.result, ...(result.result.pendingProposal && jobs ? jobs.waitScript(current.id, sessionId) : {}) })
      }
      const selected = await links.projectForSession(sessionId)
      if (selected.projectId && (args.action === 'create' || args.projectId !== selected.projectId)) {
        throw Object.assign(new Error('当前会话已关联视频项目，请切换工作区或新建会话'), { status: 409 })
      }
      if (args.action === 'create' && args.fields && Object.keys(args.fields).some(key => !['title', 'mode', 'premise', 'script', 'scriptAssetId', 'style', 'aspectRatio'].includes(key))) throw new Error('创建字段无效')
      let projectId = args.projectId
      let operationId
      await runWithSessionLog(exec.agent.session, async () => {
        if (args.action === 'create') {
          const place = await createProject({ home, tasks, fields: args.fields, sessionId, session: exec.agent.session, signal: exec.signal, workspaceController, origin: 'session',
            enter: async project => { await links.selectProject(sessionId, project.id, store); return { projectId: project.id, sessionId, workspaceId: project.workspaceId } } })
          projectId = place.projectId
          operationId = place.operationId
        }
        if (args.action === 'open') await links.ensureProject(projectId, store)
        const project = await store.read(projectId)
        await links.selectProject(sessionId, project.id, store)
        insertSessionLog(exec.agent.session, `已${args.action === 'create' ? '创建' : '打开'}项目《${project.title}》`)
      })
      const project = await store.read(projectId)
      return JSON.stringify({ status: operationId ? 'running' : 'completed', ...(operationId ? { operationId } : {}), projectId, title: project.title, workspaceId: project.workspaceId })
    },
  }
}
