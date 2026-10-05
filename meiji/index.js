import { modelStore } from './server/data/model-settings.js'
import { syncChatModel } from './server/host/harness-chat-model.js'
import { registerPanel } from './server/http/panel-routes.js'
import { createHarnessJobs } from './server/host/harness-jobs.js'
import { subscribeProject } from './server/data/project-events.js'
import { createOperationManager } from './server/flow/operations/operation-manager.js'
import { interruptRunning } from './server/flow/tasks/task-interrupt.js'
import { projectStore } from './server/data/project-store.js'
import { ffmpegAvailable } from './server/media/check-ffmpeg.js'
import { setHostLogger } from './server/host/session-log.js'
import { setWorkspaceRegistry } from './server/host/harness-workspaces.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'meiji'
export const inject = ['webServer', 'connection', 'settings', 'credentials', 'tools', 'sessionController', 'workspaceController', 'workspaceRegistry', 'sessions', 'jobs']
export function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  setHostLogger(ctx.logger)
  ctx.effect(() => () => setHostLogger(null), 'meiji: host logger')
  setWorkspaceRegistry(ctx.workspaceRegistry)
  ctx.effect(() => () => setWorkspaceRegistry(null), 'meiji: workspace registry')
  // 启动时取消上次遗留的进行中任务；网关不提供取消接口，已提交的远端视频如实记录可能仍在运行。
  const ready = interruptRunning(projectStore(home)).catch(error => {
    ctx.logger.warn('Meiji interrupt failed: %s', error.message)
  })
  const chatReady = ready.then(async () => {
    const routes = await modelStore(home).read()
    if (routes.apiKey) await syncChatModel(ctx, routes)
  }).catch(() => ctx.logger.warn('Meiji: 会话网关配置同步失败，请检查模型设置与凭据服务'))
  void ffmpegAvailable().then(found => {
    if (!found) ctx.logger.warn('Meiji: 未找到 ffmpeg，尾帧提取、全片拼接与图片压缩将不可用；请安装 ffmpeg 并确保在 PATH 中')
  })
  const tasks = createOperationManager({ home, workspaceController: ctx.workspaceController })
  ctx.effect(() => () => tasks.dispose(), 'meiji: tasks')
  const jobs = createHarnessJobs({ home, manager: tasks, registry: ctx.jobs, logger: ctx.logger, subscribeProject, readProject: id => projectStore(home).read(id) })
  ctx.effect(() => ctx.jobs.attachController('meiji'), 'meiji: jobs controller')
  ctx.effect(() => ctx.tools.guard(exec => jobs.guard(exec)), 'meiji: job kill guard')
  ctx.effect(() => () => jobs.dispose(), 'meiji: jobs observer')
  registerPanel(ctx, chatReady, tasks, jobs)
  ctx.provide('meiji', { home, tasks, jobs, ready: chatReady, workspaceController: ctx.workspaceController })
}
