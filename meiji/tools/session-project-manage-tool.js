import { projectStore } from '../server/data/project-store.js'
import { linkStore } from '../server/data/workspace-links.js'
import { runWithSessionLog, insertSessionLog } from '../server/host/session-log.js'
import { jsonOutput, sessionIdOf } from './session-context-query-tool.js'
import { createProject } from '../server/flow/project-creation.js'

export function projectManageTool({ home, tasks, workspaceController }) {
  return {
    name: 'meiji_project_manage',
    description: '创建或打开故事项目，并将当前会话的制作目标选为该项目。create 填写 fields.title，以及 summary 或剧本 script/scriptAssetId；导入剧本后自动启动项目摘要提取（不超过500字），返回 operationId，可等待完成后生成剧集摘要。无剧本时保存总摘要。创建不生成剧集。open 使用查询工具返回的 projectId。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['create', 'open'] }, projectId: { type: 'string' },
      fields: { type: 'object', additionalProperties: false, required: ['title'], properties: {
        title: { type: 'string' }, summary: { type: 'string' }, script: { type: 'string' }, scriptAssetId: { type: 'string' }, style: { type: 'string' }, aspectRatio: { type: 'string', enum: ['1344x768', '768x1344'] },
      } },
    } }, output: jsonOutput,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec), store = projectStore(home), links = linkStore(home, workspaceController)
      if (!['create', 'open'].includes(args.action)) throw new Error('项目操作无效')
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
