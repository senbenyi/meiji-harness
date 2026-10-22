import { configureMainAgent, mainAgentProvider } from './src/settings/main-agent.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OptimizeScriptTool } from './src/tools/optimize_script_tool.js'
import { CreateProjectTool } from './src/tools/creat_project_tool.js'
import { ProjectService } from './src/node_box/project/service.js'
import { ScriptRevisionService } from './src/node_box/script_revision/service.js'
import { createRecordService } from './src/records/service.js'
import { createModelSettings } from './src/settings/model-settings.js'
import { createProjectHttpHandler } from './src/harness_server/project_routes.js'
import { PlanningContextTool, UpdateProjectTool, ChangeRulesTool } from './src/tools/planning_tools.js'
import { boxReport } from './src/node_runtime/box_report.js'
import { createPanelTaskDisplay } from './src/session/panel_task_messages.js'
import { ReportDispatcher, createMainAgentDelivery } from './src/session/report_dispatcher.js'

export const name = 'drama'
export const inject = ['webServer', 'connection', 'workspaceController', 'sessionController', 'settings', 'credentials', 'llm', 'agents']

export function apply(ctx) {
  const tool = new ProjectService({
    root: join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'drama'),
    workspaceController: ctx.workspaceController,
    sessionController: ctx.sessionController,
  })
  tool.createProjectTool = new CreateProjectTool({ projects: tool })
  tool.models = createModelSettings(tool.root, { onSessionModel: config => configureMainAgent(ctx, config) })
  tool.configureOriginalSummary(tool.models)
  tool.records = createRecordService(tool.root)
  const scriptRevision = new ScriptRevisionService({ projects: tool, records: tool.records, models: tool.models })
  tool.optimizeScriptTool = new OptimizeScriptTool({ scriptRevision })
  tool.planningTools = [new PlanningContextTool({ projects: tool, records: tool.records }), new UpdateProjectTool({ projects: tool }),
    new ChangeRulesTool({ projects: tool, records: tool.records, scriptRevision })]
  tool.applyMainAgent = async sessionId => {
    await tool.ready
    const config = await tool.models.read()
    return ctx.sessionController.selectModel({ sessionId, provider: mainAgentProvider, model: config.session.model })
  }
  ctx.provide('drama', tool)
  tool.ready = tool.models.read().then(config => configureMainAgent(ctx, config))
  void tool.ready.catch(error => ctx.logger.warn('Drama 主Agent配置失败：%s', error.message))
  const display = createPanelTaskDisplay(ctx, tool)
  const dispatcher = new ReportDispatcher({ root: tool.root, records: tool.records, deliver: createMainAgentDelivery(ctx, tool), display,
    onError: error => ctx.logger.warn('主Agent报告投递待重试：%s', error.message),
  })
  tool.showPanelTaskStart = async id => {
    const detail = tool.records.tasks.detail(tool.records.scope, id)
    try { await display(boxReport(detail), 'start', detail.tasks[0].name) }
    catch (error) { ctx.logger.warn('面板开始消息展示失败：%s', error.message) }
  }
  const handler = createProjectHttpHandler(tool, { authorize: req => ctx.connection.requestRejection(req), models: tool.models, scriptRevision })
  ctx.on('llm/stream', (options, next) => tool.records.models.stream(options, next))
  for (const path of ['/plugins/drama/src/client', '/plugins/drama/packages', '/api/drama'])
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }), `drama: ${path}`)
  ctx.effect(() => async () => { await dispatcher.dispose(); await handler.dispose() }, 'drama: stop events')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'script-src', placement: 'body', src: '/plugins/drama/src/client/panel.js' }))
}
