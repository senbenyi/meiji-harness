import { registerPanel } from './server/http/routes.js'
import { episodeTool } from './tools/tool-episode.js'
import { panelTool } from './tools/tool-panel.js'
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
  registerPanel(ctx, ready)
  ctx.effect(() => ctx.tools.register(panelTool(ctx)), 'meiji: panel tool')
  ctx.effect(() => ctx.tools.register(episodeTool(ctx)), 'meiji: episode tool')
  for (const skill of allSkills()) {
    try {
      const skills = ctx.get('skills')
      if (skills) skills.register(skill)
    } catch (error) {
      ctx.logger.warn('Meiji skill %s not registered: %s', skill.name, error.message)
    }
  }
}
