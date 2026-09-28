import { projectStore } from '../server/data/projects.js'
import { linkStore } from '../server/data/links.js'
import { runOperation } from '../server/flow/actions.js'
import { runWithSessionLog, insertSessionLog } from '../server/flow/session-log.js'
import { jsonOutput, sessionIdOf } from './session-context-query-tool.js'

export function projectManageTool({ home, workspaceController }) {
  return {
    name: 'meiji_project_manage',
    description: '创建或打开故事项目，并将当前会话的制作目标选为该项目（不迁移 Harness 会话工作目录）。create 必须填写 fields.title 和 fields.summary；用户授权构思时可根据题材补全标题和总摘要，未指定画幅使用默认值。创建项目不生成剧集；成功后可继续调用摘要生成工具。open 使用查询工具返回的 projectId。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['create', 'open'] }, projectId: { type: 'string' },
      fields: { type: 'object', additionalProperties: false, required: ['title', 'summary'], properties: {
        title: { type: 'string' }, summary: { type: 'string' }, script: { type: 'string' }, style: { type: 'string' }, aspectRatio: { type: 'string', enum: ['1344x768', '768x1344'] },
      } },
    } }, output: jsonOutput,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec), store = projectStore(home), links = linkStore(home, workspaceController)
      if (!['create', 'open'].includes(args.action)) throw new Error('项目操作无效')
      let projectId = args.projectId
      await runWithSessionLog(exec.agent.session, async () => {
        if (args.action === 'create') {
          const trace = await runOperation({ action: 'create', fields: args.fields, sessionId }, { home, workspaceController, signal: exec.signal })
          projectId = trace.result.projectId
        }
        if (args.action === 'open') await links.ensureProject(projectId, store)
        const project = await store.read(projectId)
        await links.selectProject(sessionId, project.id, store)
        insertSessionLog(exec.agent.session, `已${args.action === 'create' ? '创建' : '打开'}项目《${project.title}》`)
      })
      const project = await store.read(projectId)
      return JSON.stringify({ status: 'completed', projectId, title: project.title, workspaceId: project.workspaceId })
    },
  }
}
