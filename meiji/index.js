import { registerPanel } from './server/http/routes.js'
import { contextQueryTool } from './tools/session-context-query-tool.js'
import { projectManageTool } from './tools/session-project-manage-tool.js'
import { contentGenerateTool } from './tools/session-content-generate-tool.js'
import { taskControlTool } from './tools/session-task-control-tool.js'
import { createTasks } from './server/flow/tasks/runner.js'
import { sessionSkills, validateSkills } from './skills/load.js'
import { interruptRunning } from './server/flow/tasks/restart.js'
import { projectStore } from './server/data/projects.js'
import { ffmpegAvailable } from './server/generate/ffmpeg.js'
import { setHostLogger } from './server/host/session-log.js'
import { setWorkspaceRegistry } from './server/host/workspaces.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'meiji'
export const inject = ['webServer', 'connection', 'settings', 'tools', 'sessionController', 'workspaceController', 'workspaceRegistry', 'sessions']
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
  void ffmpegAvailable().then(found => {
    if (!found) ctx.logger.warn('Meiji: 未找到 ffmpeg，尾帧提取、全片拼接与图片压缩将不可用；请安装 ffmpeg 并确保在 PATH 中')
  })
  const tasks = createTasks({ home, workspaceController: ctx.workspaceController })
  ctx.effect(() => () => tasks.dispose(), 'meiji: tasks')
  registerPanel(ctx, ready, tasks)
  for (const factory of [contextQueryTool, projectManageTool, contentGenerateTool, taskControlTool]) {
    const tool = factory({ home, tasks, workspaceController: ctx.workspaceController })
    const execute = tool.execute
    tool.execute = async (...args) => { await ready; return execute(...args) }
    ctx.effect(() => ctx.tools.register(tool), `meiji: ${tool.name}`)
  }
  // 生成流程由代码直接读取技能（skills/task 平铺的功能文件），不经 Harness；只把会话说明注册给会话 agent。
  validateSkills()
  for (const skill of sessionSkills()) {
    try {
      const skills = ctx.get('skills')
      if (skills) skills.register(skill)
    } catch (error) {
      ctx.logger.warn('Meiji skill %s not registered: %s', skill.name, error.message)
    }
  }
}
