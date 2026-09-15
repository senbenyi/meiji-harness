// 职责：组合并注册 Elysium 的工具、路由与系统提示词。
import { mkdir } from 'node:fs/promises'
import { resolveConfig, withConfig } from './config.js'
import { createComfyuiTools, createModelTools, createProjectTools, createWorkflowTools } from './tools/index.js'
import { createToolDiscoveryTool, projectTools } from './tools/discovery.js'
import { registerProjectRoutes, PROJECT_ROUTE } from './http/project-routes.js'
import { registerDirectorRoutes, DIRECTOR_ROUTE } from './http/director-routes.js'
import { registerServerRoutes, SERVER_ROUTE } from './http/server-routes.js'
import { registerMediaRoutes } from './http/media-routes.js'
import { createDirectorStore } from './business/directors/store.js'
import { createProjectStore } from './business/projects/store.js'
import { creationInstructions } from './prompts/creation.js'

export * from './tools/index.js'

export const name = '@dsh-external/dsh-elysium'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx, config = {}) {
  const runtime = resolveConfig(config)
  ctx.inject(['webServer'], mediaContext => withConfig(runtime, () => {
    const directors = createDirectorStore()
    const projects = createProjectStore({ directorExists: name => directors.has(name) })
    const token = registerMediaRoutes(mediaContext, runtime, PROJECT_ROUTE, DIRECTOR_ROUTE, SERVER_ROUTE)
    registerServerRoutes(mediaContext, runtime, token)
    registerProjectRoutes(mediaContext, runtime, token, projects)
    registerDirectorRoutes(mediaContext, runtime, token, directors, projects)
    for (const definition of createProjectTools(projects)) {
      const tool = { ...definition, execute: (...args) => withConfig(runtime, () => definition.execute(...args)) }
      mediaContext.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium: ${tool.name} tool`)
    }
  }))
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = projectTools(await next(), context.agent)
    return { ...assembly, sections: [...assembly.sections.filter(section => section.name !== 'elysium:creation-commands'),
      { name: 'elysium:creation-commands', text: creationInstructions }] }
  })
  const tools = [createToolDiscoveryTool(ctx), ...createWorkflowTools(), ...createModelTools(),
    ...(runtime.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1' ? createComfyuiTools() : [])]
  for (const definition of tools) {
    const tool = { ...definition, execute: (...args) => withConfig(runtime, async () => {
      await mkdir(runtime.ELYSIUM_STATE_ROOT, { recursive: true })
      return definition.execute(...args)
    }) }
    if (typeof ctx.effect === 'function' && typeof ctx.tools?.register === 'function') {
      ctx.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium: ${tool.name} tool`)
    } else if (typeof ctx.tools?.register === 'function') {
      ctx.tools.register(tool)
    }
  }
  ctx.logger?.info?.(`[elysium] ${tools.length} tools loaded`)
}
