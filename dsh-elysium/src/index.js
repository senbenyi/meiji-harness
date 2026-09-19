// 职责：组合并注册 Elysium 的工具、路由与系统提示词。
import { mkdir } from 'node:fs/promises'
import { resolveConfig, withConfig } from './config.js'
import { createComfyuiTools, createDirectorTools, createModelTools, createProjectTools, createWorkflowTools } from './tools/index.js'
import { createToolDiscoveryTool } from './tools/core/discovery.js'
import { isElysiumAgent, projectTools } from './tools/agent.js'
import { registerProjectRoutes, PROJECT_ROUTE } from './server/routes/projects.js'
import { registerDirectorRoutes, DIRECTOR_ROUTE } from './server/routes/directors.js'
import { registerSettingsRoutes, SETTINGS_ROUTE } from './server/routes/settings.js'
import { registerMediaRoutes } from './server/routes/media.js'
import { createDirectorStore } from './server/directors/service.js'
import { createProjectStore } from './server/projects/service.js'
import { providerCreationInstructions } from './models/managers/runtime/index.js'
import { creationInstructions } from './tools/prompts/creation.js'
import { createProjectWorkflow } from './server/projects/workflow.js'
import { createProjectWorkflowTools } from './tools/project/workflow.js'
import { statusError } from './utils/errors.js'

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
    const workflow = createProjectWorkflow(projects)
    workflow.production.interruptPending().catch(error => ctx.logger?.warn?.(error.message))
    mediaContext.effect(() => {
      let busy = false
      const tick = () => withConfig(runtime, async () => {
        if (busy) return
        busy = true
        try { for (const p of await projects.list()) await workflow.production.refresh(p.id).catch(error => ctx.logger?.warn?.(error.message)) }
        finally { busy = false }
      }).catch(error => ctx.logger?.warn?.(error.message))
      const timer = setInterval(tick, 4000); timer.unref?.(); tick()
      return () => clearInterval(timer)
    }, `${effectPrefix}: segment queue recovery`)
    const pageToken = registerMediaRoutes(mediaContext, runtime, PROJECT_ROUTE, DIRECTOR_ROUTE, SETTINGS_ROUTE)
    registerSettingsRoutes(mediaContext, runtime, pageToken)
    registerProjectRoutes(mediaContext, runtime, pageToken, projects, workflow)
    registerDirectorRoutes(mediaContext, runtime, pageToken, directors, projects)
    for (const definition of [...createDirectorTools(directors), ...createProjectTools(projects), ...createProjectWorkflowTools(workflow)]) {
      // 将导演/项目工具绑定到当前插件实例的运行时配置。
      const tool = { ...definition, execute: (args, exec) => withConfig(runtime, async () => {
        const sessionId = exec?.agent?.session?.id
        const bound = sessionId && (await projects.list()).find(p => p.chat_session_id === sessionId)
        if (bound && args.project_id && args.project_id !== bound.id) throw statusError(409, '当前会话仅能操作关联项目，请先在项目列表切换项目')
        return definition.execute(args, exec)
      }) }
      mediaContext.effect(() => ctx.tools.register(tool), `${effectPrefix}: ${tool.name} tool`)
    }
  }))
}

// 在每次模型请求前过滤当前 Agent 可见工具，并仅为 Elysium Agent 注入创作指令。
function registerPromptAssembly(ctx, runtime) {
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = projectTools(await next(), context.agent)
    if (!isElysiumAgent(context.agent)) return assembly
    // 替换已有同名段落，确保创作指令只出现一次。
    return { ...assembly, sections: [...assembly.sections.filter(section => section.name !== 'elysium:creation-commands'),
        { name: 'elysium:creation-commands', text: await withConfig(runtime, async () => {
          const sessionId = context.agent?.session?.id
          const project = sessionId && (await createProjectStore().list()).find(p => p.chat_session_id === sessionId)
          return [creationInstructions, await providerCreationInstructions(), project ? `当前会话关联项目 ID：${project.id}，名称：${JSON.stringify(project.title)}。用户提到本项目、修改剧情或分镜时，先 project_read 读取该项目最新内容，然后使用 project_edit_segment 或 project_edit_production 保存对应 Scene/Segment 的修改。不可将历史其他项目作为目标。流程卡片下一步代表当前阶段所有 Segment 的人工审核，不可由聊天工具批准视频。` : ''].filter(Boolean).join('\n')
        }) }] }
  })
}

// 注册基础工具，并保持工具定义的 schema、output 和执行策略不变。
function registerRuntimeTools(ctx, runtime) {
  const tools = [createToolDiscoveryTool(ctx), ...createWorkflowTools(), ...createModelTools(), ...createComfyuiTools(runtime)]
  for (const definition of tools) {
    registerTool(ctx, bindRuntimeTool(definition, runtime))
  }
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
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => ctx.tools.register(tool), `${effectPrefix}: ${tool.name} tool`)
  } else {
    ctx.tools.register(tool)
  }
}
