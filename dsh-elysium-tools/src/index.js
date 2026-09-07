import { createModelTools } from './functions/index.js'
import { createWorkflowTools } from './workflows/index.js'
import { createComfyuiTaskQueueTool } from './functions/comfyui/task-queue.js'
import { createComfyuiTaskStatusTool } from './functions/comfyui/task-status.js'
import { createComfyuiTaskResultTool } from './functions/comfyui/task-result.js'
import { createComfyuiTaskCancelTool } from './functions/comfyui/task-cancel.js'
import { createToolDiscoveryTool, projectTools } from './tool-discovery.js'
import { registerMediaRoutes } from './http/media-jobs.js'

export * from './functions/index.js'
export * from './workflows/index.js'

export const name = '@dsh-external/dsh-elysium-tools'
export const inject = ['tools', 'systemPrompt']

export function createComfyuiTools() {
  return [createComfyuiTaskQueueTool(), createComfyuiTaskStatusTool(),
    createComfyuiTaskResultTool(), createComfyuiTaskCancelTool()]
}

export function apply(ctx) {
  registerMediaRoutes(ctx)
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => projectTools(await next(), context.agent))
  const tools = [createToolDiscoveryTool(ctx), ...createWorkflowTools(), ...createModelTools().filter(tool =>
    process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1' || ['model_job_status', 'model_job_result'].includes(tool.name)),
    ...(process.env.ELYSIUM_ENABLE_ATOMIC_TOOLS === '1' ? createComfyuiTools() : [])]
  for (const tool of tools) {
    if (typeof ctx.effect === 'function' && typeof ctx.tools?.register === 'function') {
      ctx.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium-tools: ${tool.name} tool`)
    } else if (typeof ctx.tools?.register === 'function') {
      ctx.tools.register(tool)
    }
  }
  ctx.logger?.info?.(`[elysium-tools] ${tools.length} tools loaded`)
}
