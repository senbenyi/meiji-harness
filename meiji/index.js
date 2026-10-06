import { modelStore } from './server/data/model-settings.js'
import { syncChatModel } from './server/host/harness-chat-model.js'
import { registerPanel } from './server/http/panel-routes.js'
import { subscribeProject } from './server/data/project-events.js'
import { createImmediateService } from './server/flow/immediate-service.js'
import { createHarnessRunGoals } from './server/host/harness-run-goals.js'
import { runStore } from './server/data/run-store.js'
import { interruptRunning } from './server/flow/tasks/task-interrupt.js'
import { projectStore } from './server/data/project-store.js'
import { ffmpegAvailable } from './server/media/check-ffmpeg.js'
import { setHostLogger } from './server/host/session-log.js'
import { setWorkspaceRegistry } from './server/host/harness-workspaces.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRunService } from './server/flow/runs/run-service.js'
import { createHarnessRunJobs } from './server/host/harness-run-jobs.js'
import { createQueue, defaultConcurrency } from './server/flow/tasks/task-queue.js'

export const name = 'meiji'
export const inject = ['webServer', 'connection', 'settings', 'credentials', 'tools', 'sessionController', 'workspaceController', 'workspaceRegistry', 'sessions', 'jobs', 'goals']
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
  const queue = createQueue(async kind => (await modelStore(home).read()).concurrency?.[kind] ?? defaultConcurrency[kind])
  let runGoals
  const runs = createRunService({ home, queue, onChange: run => runGoals?.observe(run) })
  const edits = createImmediateService({ home, workspaceController: ctx.workspaceController, runs })
  runGoals = createHarnessRunGoals({ goals: ctx.goals, resolveAgent: id => ctx.sessionController.resolveAgent(id), readBinding: (projectId, id) => runStore(home, projectId).read(id), saveBinding: (projectId, id, binding) => runStore(home, projectId).update(id, run => ({ ...run, ...binding })) })
  const runJobs = createHarnessRunJobs({ home, registry: ctx.jobs, readRun: (...args) => runs.get(...args), cancelRun: (...args) => runs.cancel(...args), subscribeProject })
  ctx.effect(() => () => runs.dispose(), 'meiji: run engine')
  ctx.effect(() => () => runJobs.dispose(), 'meiji: run jobs')
  ctx.effect(() => ctx.tools.guard(exec => runJobs.guard(exec)), 'meiji: run job kill guard')
  const runReady = ready.then(async () => { for (const project of await projectStore(home).list()) await runs.recover(project.id) })
    .catch(error => { ctx.logger.warn('Meiji Run recovery failed: %s', error.message); throw error })
  ctx.effect(() => () => edits.dispose(), 'meiji: immediate edits')
  ctx.effect(() => ctx.jobs.attachController('meiji'), 'meiji: jobs controller')
  const serviceReady = Promise.all([chatReady, runReady])
  ctx.on('agent/created', ({ agent }) => {
    void serviceReady.then(async () => {
      for (const project of await projectStore(home).list()) for (const run of await runStore(home, project.id).list()) if (run.goalSessionId === agent.id) runGoals.observe(run)
      await runGoals.drain()
    }).catch(error => ctx.logger.warn('Meiji 会话任务目标恢复失败：%s', error.message))
  })
  serviceReady.catch(() => {}) // 错误仍由 ready 拒绝和面板 503 报告，避免无人请求时产生未处理拒绝。
  registerPanel(ctx, serviceReady, edits, runs, runJobs)
  ctx.provide('meiji', { home, edits, runs, runJobs, runGoals, ready: serviceReady, workspaceController: ctx.workspaceController })
}
