// 职责：组合并注册 Elysium 的工具、路由与系统提示词。
import { mkdir } from './database/files.js'
//config
import { resolveConfig, withConfig } from './config.js'
// session
import { createCallToolsForAgent } from './session/index.js'
//server
import { registerWebRoutes, createWebStores } from './server/index.js'
// tools
import { createCallToolsProject, createCallToolsRuntime } from './tools/index.js'
import { createTaskDriver } from './worker/index.js'
import { createFilmDriver } from './server/projects/film.js'
import { createPipelineDriver } from './server/projects/pipeline.js'

export const name = '@dsh-external/dsh-elysium'
export const inject = ['tools', 'systemPrompt', 'jobs']
const effectPrefix = '@dsh-external/dsh-elysium'

/*
 * 完整调用链：
 * Harness 启动 -> Cordis 加载插件 -> apply 解析配置并注册工具/routes/提示词钩子。
 * 每次模型请求前 -> system-prompt/assemble -> createCallToolsForAgent 按 Agent 预设过滤工具 -> schema 发送给 LLM。
 * LLM 返回 tool-call -> AgentLoop 记录 tool/call -> ToolRuntime 按 name 查找定义并检查策略。
 * ToolRuntime 调用 definition.execute -> Elysium service/store/backend -> 返回原始 value。
 * ToolRuntime 执行 output.schema 校验和 output.render -> AgentLoop 记录 tool/result -> 下一轮模型读取结果。
 */
// 插件入口：只负责编排配置、Web 功能、提示词钩子和基础工具注册。
export function apply(ctx, config = {}) {
  const runtime = resolveConfig(config)
  registerWebFeatures(ctx, runtime)
  registerPromptAssembly(ctx)
  registerRuntimeTools(ctx, runtime)
}

// 创建 Web 与聊天工具共享的 Store，并在同一 Web 生命周期中注册 routes 和工具。
function registerWebFeatures(ctx, runtime) {
  ctx.inject(['webServer'], mediaContext => withConfig(runtime, () => {
    const stores = createWebStores()
    const driveFilm = createFilmDriver(stores.projects, ctx.logger), drivePipeline = createPipelineDriver(stores.projects, ctx.logger)
    let reconciling = false
    const driveProjects = async () => {
      if (reconciling) return { active: true }
      reconciling = true
      try {
        const film = await driveFilm().catch(error => { ctx.logger?.error?.(`[elysium] film reconcile: ${error.message}`); return { active: false } })
        const pipeline = await drivePipeline()
        return { active: film.active || pipeline.active }
      }
      finally { reconciling = false }
    }
    const driver = createTaskDriver({ execute: action => withConfig(runtime, action), logger: ctx.logger, driveProjects })
    driver.start()
    const timer = setInterval(() => withConfig(runtime, driveProjects).catch(error => ctx.logger?.error?.(`[elysium] project reconcile: ${error.message}`)), 2000)
    timer.unref?.()
    mediaContext.effect(() => () => { clearInterval(timer); driver.stop() }, `${effectPrefix}: task driver`)
    registerWebRoutes(mediaContext, runtime, stores)
    registerWebTools(ctx, mediaContext, runtime, stores)
  }))
}

// 注册依赖 Web Store 的导演与项目工具，并让注销跟随 Web 生命周期。
function registerWebTools(ctx, mediaContext, runtime, stores) {
  for (const definition of createCallToolsProject(stores, ctx)) {
    const tool = { ...definition, execute: (...args) => withConfig(runtime, () => definition.execute(...args)) }
    mediaContext.effect(() => ctx.tools.register(tool), `${effectPrefix}: ${tool.name} tool`)
  }
}

// 在每次模型请求前过滤当前 Agent 可见工具，并仅为 Elysium Agent 注入创作规则。
function registerPromptAssembly(ctx) {
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => createCallToolsForAgent(await next(), context.agent))
}

// 注册基础工具，并保持工具定义的 schema、output 和执行策略不变。
function registerRuntimeTools(ctx, runtime) {
  const tools = createCallToolsRuntime(ctx)
  for (const definition of tools) registerTool(ctx, bindRuntimeTool(definition, runtime))
  ctx.logger?.info?.(`[elysium] ${tools.length} tools loaded`)
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
  if (typeof ctx.effect === 'function') ctx.effect(() => ctx.tools.register(tool), `${effectPrefix}: ${tool.name} tool`)
  else ctx.tools.register(tool)
}
