import {ReadMemoryTool,WriteMemoryTool,MaintainMemoryTool} from './src/tools/memory_tools.js'
import {RunProductionTool,ProductionContextTool,EditProductionTool} from './src/tools/production_tools.js'
import {ProductionService} from './src/production/service.js'
import {ProjectWorkspaceService} from './src/project_runtime/project_workspace_service.js'
import { configureMainAgent, mainAgentProvider } from './src/settings/main-agent.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CreateProjectTool } from './src/tools/creat_project_tool.js'
import { createRecordService } from './src/records/service.js'
import { createModelSettings } from './src/settings/model-settings.js'
import { createProjectHttpHandler } from './src/harness_server/project_routes.js'
import { boxReport } from './src/node_runtime/box_report.js'
import { createPanelTaskDisplay } from './src/session/panel_task_messages.js'
import { ReportDispatcher, createMainAgentDelivery } from './src/session/report_dispatcher.js'

export const name = 'drama'
export const inject = ['webServer', 'connection', 'workspaceController', 'workspaceRegistry', 'sessionController', 'settings', 'credentials', 'llm', 'agents']

export function apply(ctx) {
  const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'drama')
  const tool = new ProjectWorkspaceService({
    root, records:createRecordService(root),
    workspaceController: ctx.workspaceController,
    sessionController: ctx.sessionController,
    workspaceForSession: sessionId => ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId)),
  })
  tool.createProjectTool = new CreateProjectTool({ projects: tool })
  tool.models = createModelSettings(tool.root, { onSessionModel: config => configureMainAgent(ctx, config) })
  const production=new ProductionService({projects:tool,models:tool.models})
  tool.productionTools=[new ProductionContextTool(tool),new RunProductionTool(production),new EditProductionTool(tool),new ReadMemoryTool(tool),new WriteMemoryTool(tool),new MaintainMemoryTool(production.memoryMaintenance)]
  tool.applyMainAgent = async sessionId => {
    await tool.ready
    const config = await tool.models.read()
    return ctx.sessionController.selectModel({ sessionId, provider: mainAgentProvider, model: config.session.model })
  }
  ctx.provide('drama', tool)
  tool.ready = tool.models.read().then(config => configureMainAgent(ctx, config))
  void tool.ready.catch(error => ctx.logger.warn('Drama 主Agent配置失败：%s', error.message))
  const display = createPanelTaskDisplay(ctx, tool)
  tool.readTaskMessages = display.read
  const dispatcher = new ReportDispatcher({ root: tool.root, records: tool.records, deliver: createMainAgentDelivery(ctx, tool), display,
    onError: error => ctx.logger.warn('主Agent报告投递待重试：%s', error.message),
  })
  tool.showPanelTaskStart = async id => {
    const detail = tool.records.tasks.detail(tool.records.scope, id)
    try { await display(boxReport(detail), 'start', detail.tasks[0].name) }
    catch (error) { ctx.logger.warn('面板开始消息展示失败：%s', error.message) }
  }
  const handler = createProjectHttpHandler(tool, { authorize: req => ctx.connection.requestRejection(req), models: tool.models })
  ctx.on('llm/stream', async function*(options,next){try{await production.memoryMaintenance.observe(options)}catch(error){ctx.logger.warn('视频制作对话记忆记录/整理失败：%s',error.message)}yield* tool.records.models.stream(options,next)})
  for (const path of ['/plugins/drama/src/client', '/plugins/drama/src/node_box', '/plugins/drama/src/shared', '/plugins/drama/packages', '/api/drama'])
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }), `drama: ${path}`)
  ctx.effect(() => async () => { await tool.records.tasks.dispose(); await dispatcher.dispose(); await tool.production.dispose(); await handler.dispose() }, 'drama: stop events')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'script-src', placement: 'body', src: '/plugins/drama/src/client/panel.js' }))
}
