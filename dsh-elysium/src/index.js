// 职责：组合并注册 Elysium 的工具、路由与系统提示词。
import { mkdir } from 'node:fs/promises'
import { resolveConfig, withConfig } from './config.js'
import { createComfyuiTools, createDirectorTools, createModelTools, createProjectTools, createWorkflowTools } from './tools/index.js'
import { createToolDiscoveryTool } from './tools/load.js'
import { isElysiumAgent, projectTools } from './tools/agent.js'
import { registerProjectRoutes, PROJECT_ROUTE } from './server/routes/projects.js'
import { registerDirectorRoutes, DIRECTOR_ROUTE } from './server/routes/directors.js'
import { registerSettingsRoutes, SETTINGS_ROUTE } from './server/routes/settings.js'
import { registerMediaRoutes } from './server/routes/media.js'
import { createDirectorStore } from './server/directors/service.js'
import { createProjectStore } from './server/projects/service.js'
import { providerCreationInstructions } from './models/managers/runtime/index.js'
import { creationInstructions } from './tools/prompts/creation.js'

export const name = '@dsh-external/dsh-elysium'
export const inject = ['tools', 'systemPrompt']
export * from './tools/index.js'
const effectPrefix = '@dsh-external/dsh-elysium'

/*
 * 完整调用链：
 * Harness 启动 -> Cordis 加载插件 -> apply 解析配置并注册工具/routes/提示词钩子。
 * 每次模型请求前 -> system-prompt/assemble -> projectTools 按 Agent 预设过滤工具 -> schema 发送给 LLM。
 * LLM 返回 tool-call -> AgentLoop 记录 tool/call -> ToolRuntime 按 name 查找定义并检查策略。
 * ToolRuntime 调用 definition.execute -> Elysium service/store/backend -> 返回原始 value。
 * ToolRuntime 执行 output.schema 校验和 output.render -> AgentLoop 记录 tool/result -> 下一轮模型读取结果。
 */
// 插件入口：只负责编排配置、Web 功能、提示词钩子和基础工具注册。
export function apply(ctx, config = {}) {
  const runtime = resolveConfig(config)
  registerWebFeatures(ctx, runtime)
  registerPromptAssembly(ctx, runtime)
  registerRuntimeTools(ctx, runtime)
}

// 创建 Web 与聊天工具共享的 Store，并在同一 Web 生命周期中注册 routes 和工具。
function registerWebFeatures(ctx, runtime) {
  ctx.inject(['webServer'], mediaContext => withConfig(runtime, () => {
    const directors = createDirectorStore()
    const projects = createProjectStore({ directorExists: name => directors.has(name) })
    const token = registerMediaRoutes(mediaContext, runtime, PROJECT_ROUTE, DIRECTOR_ROUTE, SETTINGS_ROUTE)
    registerSettingsRoutes(mediaContext, runtime, token)
    registerProjectRoutes(mediaContext, runtime, token, projects)
    registerDirectorRoutes(mediaContext, runtime, token, directors, projects)
    for (const definition of [...createDirectorTools(directors), ...createProjectTools(projects)]) {
      const tool = bindStoreTool(definition, runtime)
      mediaContext.effect(() => ctx.tools.register(tool), `${effectPrefix}: ${tool.name} tool`)
    }
  }))

// 将导演/项目工具绑定到当前插件实例的运行时配置。
function bindStoreTool(definition, runtime) {
  return { ...definition, execute: (...args) => withConfig(runtime, () => definition.execute(...args)) }
}

// 将基础工具绑定到当前实例，执行前确保状态根目录存在。
function bindRuntimeTool(definition, runtime) {
  return { ...definition, execute: (...args) => withConfig(runtime, async () => {
    await mkdir(runtime.ELYSIUM_STATE_ROOT, { recursive: true })
    return definition.execute(...args)
  }) }
}

// 注册工具定义；Harness 支持生命周期时，将注销函数交由 effect 管理。
function registerTool(ctx, tool) {
  if (typeof ctx.tools?.register !== 'function') return
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => ctx.tools.register(tool), `${effectPrefix}: ${tool.name} tool`)
  } else {
    ctx.tools.register(tool)
  }
}


}

// 在每次模型请求前过滤当前 Agent 可见工具，并仅为 Elysium Agent 注入创作指令。
function registerPromptAssembly(ctx, runtime) {
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = projectTools(await next(), context.agent)
    if (!isElysiumAgent(context.agent)) return assembly
    // 替换已有同名段落，确保创作指令只出现一次。
    return { ...assembly, sections: [...assembly.sections.filter(section => section.name !== 'elysium:creation-commands'),
      { name: 'elysium:creation-commands', text: await withConfig(runtime, async () => [creationInstructions, await providerCreationInstructions()].filter(Boolean).join('\n')) }] }
  })
}

// 组合 9 个基础工具；开启原子工具时再追加 4 个 ComfyUI 工具。
function createRuntimeTools(ctx, runtime) {
  return [createToolDiscoveryTool(ctx), ...createWorkflowTools(), ...createModelTools(),
    ...(runtime.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1' ? createComfyuiTools() : [])]
}

// 注册基础工具，并保持工具定义的 schema、output 和执行策略不变。
function registerRuntimeTools(ctx, runtime) {
  const tools = createRuntimeTools(ctx, runtime)
  for (const definition of tools) {
    registerTool(ctx, bindRuntimeTool(definition, runtime))
  }
  ctx.logger?.info?.(`[elysium] ${tools.length} tools loaded`)
}
