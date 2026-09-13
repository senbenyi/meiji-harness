import { mkdir } from 'node:fs/promises'
import { resolveConfig, withConfig } from './config.js'
import { createModelTools } from './functions/index.js'
import { createWorkflowTools } from './workflows/index.js'
import { createComfyuiTaskQueueTool } from './functions/comfyui/task-queue.js'
import { createComfyuiTaskStatusTool } from './functions/comfyui/task-status.js'
import { createComfyuiTaskResultTool } from './functions/comfyui/task-result.js'
import { createComfyuiTaskCancelTool } from './functions/comfyui/task-cancel.js'
import { createToolDiscoveryTool, projectTools } from './tool-discovery.js'
import { registerProjectRoutes, PROJECT_ROUTE } from './http/project.js'
import { registerMediaRoutes } from './http/media-jobs.js'
import { creationInstructions } from './creation-instructions.js'

export * from './functions/index.js'
export * from './workflows/index.js'

export const name = '@dsh-external/dsh-elysium-tools'
export const inject = ['tools', 'systemPrompt']

export function createComfyuiTools() {
  return [createComfyuiTaskQueueTool(), createComfyuiTaskStatusTool(),
    createComfyuiTaskResultTool(), createComfyuiTaskCancelTool()]
}

export function apply(ctx, config = {}) {
  const runtime = resolveConfig(config)
  ctx.inject(['webServer'], mediaContext => withConfig(runtime, () => {
    const token = registerMediaRoutes(mediaContext, runtime, PROJECT_ROUTE)
    registerProjectRoutes(mediaContext, runtime, token)
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
      await mkdir(runtime.ELYSIUM_TOOLS_STATE_ROOT, { recursive: true })
      return definition.execute(...args)
    }) }
    if (typeof ctx.effect === 'function' && typeof ctx.tools?.register === 'function') {
      ctx.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium-tools: ${tool.name} tool`)
    } else if (typeof ctx.tools?.register === 'function') {
      ctx.tools.register(tool)
    }
  }
  ctx.logger?.info?.(`[elysium-tools] ${tools.length} tools loaded`)
}
