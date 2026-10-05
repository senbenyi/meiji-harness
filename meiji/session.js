// 仅由短剧制作预设加载；主机插件提供共享运行时，不向全局注册会话工具。
import { contextQueryTool } from './tools/session-context-query-tool.js'
import { projectManageTool } from './tools/session-project-manage-tool.js'
import { operationTools, waitImagesTool } from './tools/session-operation-tools.js'
import { sessionSkills, validateSkills } from './skills/load-skills.js'
export const name = 'meiji-session'
export const inject = ['meiji', 'tools', 'skills']
export function apply(ctx) {
  const runtime = ctx.meiji
  for (const tool of [contextQueryTool(runtime), projectManageTool(runtime), waitImagesTool(runtime), ...operationTools(runtime)]) {
    const execute = tool.execute
    tool.execute = async (...args) => { await runtime.ready; return execute(...args) }
    ctx.effect(() => ctx.tools.register(tool), `meiji session: ${tool.name}`)
  }
  validateSkills()
  for (const skill of sessionSkills()) ctx.effect(() => ctx.skills.register(skill), `meiji session skill: ${skill.name}`)
}
