import { createModelTools } from './functions/index.js'
import { createComfyuiTaskQueueTool } from './functions/comfyui/task-queue.js'
import { createComfyuiTaskStatusTool } from './functions/comfyui/task-status.js'
import { createComfyuiTaskResultTool } from './functions/comfyui/task-result.js'
import { createComfyuiTaskCancelTool } from './functions/comfyui/task-cancel.js'

export * from './functions/index.js'
export * from './workflows/index.js'

export const name = '@dsh-external/dsh-elysium-tools'
export const inject = ['tools']

export function createComfyuiTools() {
  return [createComfyuiTaskQueueTool(), createComfyuiTaskStatusTool(),
    createComfyuiTaskResultTool(), createComfyuiTaskCancelTool()]
}

export function apply(ctx) {
  const tools = [...createModelTools(), ...createComfyuiTools()]
  for (const tool of tools) {
    if (typeof ctx.effect === 'function' && typeof ctx.tools?.register === 'function') {
      ctx.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium-tools: ${tool.name} tool`)
    } else if (typeof ctx.tools?.register === 'function') {
      ctx.tools.register(tool)
    }
  }
  ctx.logger?.info?.(`[elysium-tools] ${tools.length} tools loaded`)
}
