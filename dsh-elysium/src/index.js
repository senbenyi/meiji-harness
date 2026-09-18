// 职责：组合并注册 Elysium 的工具、路由与系统提示词。
import { mkdir } from 'node:fs/promises'
import { resolveConfig, withConfig } from './utils/config.js'
import { createComfyuiTools, createDirectorTools, createModelTools, createProjectTools, createWorkflowTools } from './harness/index.js'
import { createToolDiscoveryTool } from './harness/load.js'
import { isElysiumAgent, projectTools } from './utils/agent.js'
import { registerProjectRoutes, PROJECT_ROUTE } from './http/project-routes.js'
import { registerDirectorRoutes, DIRECTOR_ROUTE } from './http/director-routes.js'
import { registerServerRoutes, SERVER_ROUTE } from './http/server-routes.js'
import { registerMediaRoutes } from './http/media-routes.js'
import { createDirectorStore } from './business/directors/store.js'
import { createProjectStore } from './business/projects/store.js'
import { providerCreationInstructions } from './servers/runtime/index.js'
import { creationInstructions } from './prompts/creation.js'

export * from './harness/index.js'

export const name = '@dsh-external/dsh-elysium'
export const inject = ['tools', 'systemPrompt']

// 插件入口：解析实例配置，注册 Web 服务、工具及创作提示词。
export function apply(ctx, config = {}) {
  const runtime = resolveConfig(config)
  // 项目工具与 HTTP 路由共享存储，并随 Web 上下文一起释放。
  ctx.inject(['webServer'], mediaContext => withConfig(runtime, () => {
    const directors = createDirectorStore()
    const projects = createProjectStore({ directorExists: name => directors.has(name) })
    const token = registerMediaRoutes(mediaContext, runtime, PROJECT_ROUTE, DIRECTOR_ROUTE, SERVER_ROUTE)
    registerServerRoutes(mediaContext, runtime, token)
    registerProjectRoutes(mediaContext, runtime, token, projects)
    registerDirectorRoutes(mediaContext, runtime, token, directors, projects)
    for (const definition of [...createDirectorTools(directors), ...createProjectTools(projects)]) {
      // 工具在注册后才被调用，执行时需重新绑定所属实例的配置。
      const tool = { ...definition, execute: (...args) => withConfig(runtime, () => definition.execute(...args)) }
      mediaContext.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium: ${tool.name} tool`)
    }
  }))
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = projectTools(await next(), context.agent)
    if (!isElysiumAgent(context.agent)) return assembly
    // 替换已有同名段落，确保创作指令只出现一次。
    return { ...assembly, sections: [...assembly.sections.filter(section => section.name !== 'elysium:creation-commands'),
      { name: 'elysium:creation-commands', text: await withConfig(runtime, async () => [creationInstructions, await providerCreationInstructions()].filter(Boolean).join('\n')) }] }
  })
  const tools = [createToolDiscoveryTool(ctx), ...createWorkflowTools(), ...createModelTools(),
    ...(runtime.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1' ? createComfyuiTools() : [])]
  for (const definition of tools) {
    // 普通工具执行时绑定实例配置，并按需创建状态目录。
    const tool = { ...definition, execute: (...args) => withConfig(runtime, async () => {
      await mkdir(runtime.ELYSIUM_STATE_ROOT, { recursive: true })
      return definition.execute(...args)
    }) }
    if (typeof ctx.tools?.register !== 'function') continue
    // 有生命周期管理时托管注销；否则直接注册。
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium: ${tool.name} tool`)
    } else {
      ctx.tools.register(tool)
    }
  }
  ctx.logger?.info?.(`[elysium] ${tools.length} tools loaded`)
}
