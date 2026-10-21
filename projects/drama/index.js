import { configureMainAgent, mainAgentProvider } from './src/settings/main-agent.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CreateProjectTool } from './src/tools/creat_project_tool.js'
import { createModelSettings } from './src/settings/model-settings.js'
import { createProjectHttpHandler } from './src/http/project_routes.js'

export const name = 'drama'
export const inject = ['webServer', 'connection', 'workspaceController', 'sessionController', 'settings', 'credentials']

export function apply(ctx) {
  const tool = new CreateProjectTool({
    root: join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'drama'),
    workspaceController: ctx.workspaceController,
    sessionController: ctx.sessionController,
  })
  tool.models = createModelSettings(tool.root, { onSessionModel: config => configureMainAgent(ctx, config) })
  tool.applyMainAgent = async sessionId => {
    await tool.ready
    const config = await tool.models.read()
    return ctx.sessionController.selectModel({ sessionId, provider: mainAgentProvider, model: config.session.model })
  }
  ctx.provide('drama', tool)
  tool.ready = tool.models.read().then(config => configureMainAgent(ctx, config))
  void tool.ready.catch(error => ctx.logger.warn('Drama 主Agent配置失败：%s', error.message))
  const handler = createProjectHttpHandler(tool, { authorize: req => ctx.connection.requestRejection(req), models: tool.models })
  for (const path of ['/plugins/drama/src/client', '/plugins/drama/packages', '/api/drama'])
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }), `drama: ${path}`)
  ctx.effect(() => () => handler.dispose(), 'drama: stop events')
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'script-src', placement: 'body', src: '/plugins/drama/src/client/panel.js' }))
}
