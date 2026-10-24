import { configureMainAgent, mainAgentProvider } from './src/settings/main-agent.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OptimizeScriptTool } from './src/tools/optimize_script_tool.js'
import { CreateProjectTool } from './src/tools/creat_project_tool.js'
import { ProjectService } from './src/node_box/project/service.js'
import { ScriptRevisionService } from './src/node_box/script_revision/service.js'
import { ShotDesignService } from './src/node_box/shot_design/service.js'
import { GenerateShotsTool } from './src/tools/generate_shots_tool.js'
import { SceneExtractionService } from './src/node_box/scene_extraction/service.js'
import { ExtractScenesTool } from './src/tools/extract_scenes_tool.js'
import { GroupSettingService } from './src/node_box/group_setting/service.js'
import { GenerateGroupsTool } from './src/tools/generate_groups_tool.js'
import { CharacterExtractionService } from './src/node_box/character_extraction/service.js'
import { SceneImageService } from './src/node_box/scene_image/service.js'
import { CostumeImageService } from './src/node_box/costume_image/service.js'
import { GenerateCostumeImagesTool } from './src/tools/generate_costume_images_tool.js'
import { ExtractCharactersTool } from './src/tools/extract_characters_tool.js'
import { StorySegmentsService } from './src/node_box/story_segments/service.js'
import { GenerateStoryOutlineTool } from './src/tools/generate_story_outline_tool.js'
import { createRecordService } from './src/records/service.js'
import { createModelSettings } from './src/settings/model-settings.js'
import { createProjectHttpHandler } from './src/harness_server/project_routes.js'
import { PlanningContextTool, UpdateProjectTool, ChangeRulesTool } from './src/tools/planning_tools.js'
import { boxReport } from './src/node_runtime/box_report.js'
import { createPanelTaskDisplay } from './src/session/panel_task_messages.js'
import { ReportDispatcher, createMainAgentDelivery } from './src/session/report_dispatcher.js'

export const name = 'drama'
export const inject = ['webServer', 'connection', 'workspaceController', 'workspaceRegistry', 'sessionController', 'settings', 'credentials', 'llm', 'agents']

export function apply(ctx) {
  const tool = new ProjectService({
    root: join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'drama'),
    workspaceController: ctx.workspaceController,
    sessionController: ctx.sessionController,
    workspaceForSession: sessionId => ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId)),
  })
  tool.createProjectTool = new CreateProjectTool({ projects: tool })
  tool.models = createModelSettings(tool.root, { onSessionModel: config => configureMainAgent(ctx, config) })
  tool.configureOriginalSummary(tool.models)
  tool.records = createRecordService(tool.root)
  const scriptRevision = new ScriptRevisionService({ projects: tool, records: tool.records, models: tool.models })
  tool.optimizeScriptTool = new OptimizeScriptTool({ scriptRevision })
  const storySegments = new StorySegmentsService({ projects: tool, records: tool.records, models: tool.models })
  const shotDesign = new ShotDesignService({ projects: tool, records: tool.records, models: tool.models })
  tool.generateShotsTool = new GenerateShotsTool({ shotDesign })
  const sceneExtraction = new SceneExtractionService({ projects: tool, records: tool.records, models: tool.models })
  tool.extractScenesTool = new ExtractScenesTool({ sceneExtraction })
  const groupSetting = new GroupSettingService({ projects: tool, records: tool.records, models: tool.models })
  tool.generateGroupsTool = new GenerateGroupsTool({ groupSetting })
  const characterExtraction = new CharacterExtractionService({ projects: tool, records: tool.records, models: tool.models })
  const sceneImages = new SceneImageService({ projects: tool, records: tool.records, models: tool.models })
  const costumeImages = new CostumeImageService({ projects: tool, records: tool.records, models: tool.models })
  tool.generateCostumeImagesTool = new GenerateCostumeImagesTool({ costumeImages })
  tool.extractCharactersTool = new ExtractCharactersTool({ characterExtraction })
  tool.generateStoryOutlineTool = new GenerateStoryOutlineTool({ storySegments })
  tool.planningTools = [new PlanningContextTool({ projects: tool, records: tool.records }), new UpdateProjectTool({ projects: tool }),
    new ChangeRulesTool({ projects: tool, records: tool.records, scriptRevision, storySegments, sceneExtraction, groupSetting, characterExtraction, shotDesign })]
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
  const handler = createProjectHttpHandler(tool, { authorize: req => ctx.connection.requestRejection(req), models: tool.models, scriptRevision, storySegments, sceneExtraction, groupSetting, characterExtraction, costumeImages, sceneImages, shotDesign })
  ctx.on('llm/stream', (options, next) => tool.records.models.stream(options, next))
  for (const path of ['/plugins/drama/src/client', '/plugins/drama/src/node_box', '/plugins/drama/packages', '/api/drama'])
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }), `drama: ${path}`)
  ctx.effect(() => async () => { await dispatcher.dispose(); await handler.dispose() }, 'drama: stop events')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'script-src', placement: 'body', src: '/plugins/drama/src/client/panel.js' }))
}
