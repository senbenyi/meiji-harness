import { registerPanel } from './server/http/routes.js'
import { contextQueryTool } from './tools/session-context-query-tool.js'
import { projectManageTool } from './tools/session-project-manage-tool.js'
import { contentGenerateTool } from './tools/session-content-generate-tool.js'
import { taskControlTool } from './tools/session-task-control-tool.js'
import { createTasks } from './server/flow/tasks.js'
import { allSkills } from './skills/load.js'
import { interruptRunning } from './server/flow/interrupt.js'
import { projectStore } from './server/data/projects.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'meiji'
export const inject = ['webServer', 'connection', 'settings', 'tools', 'sessionController', 'workspaceController', 'sessions']
export function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const ready = interruptRunning(projectStore(home)).catch(error => {
    ctx.logger.warn('Meiji interrupt failed: %s', error.message)
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
  for (const skill of allSkills()) {
    try {
      const skills = ctx.get('skills')
      if (skills) skills.register(skill)
    } catch (error) {
      ctx.logger.warn('Meiji skill %s not registered: %s', skill.name, error.message)
    }
  }
}
