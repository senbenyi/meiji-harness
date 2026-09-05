import { createModelTools } from './models/index.js'

export * from './models/index.js'

export const name = '@dsh-external/dsh-elysium-tools'
export const inject = ['tools']

export function apply(ctx) {
  const tools = createModelTools()
  for (const tool of tools) {
    if (typeof ctx.effect === 'function' && typeof ctx.tools?.register === 'function') {
      ctx.effect(() => ctx.tools.register(tool), `@dsh-external/dsh-elysium-tools: ${tool.name} tool`)
    } else if (typeof ctx.tools?.register === 'function') {
      ctx.tools.register(tool)
    }
  }
  ctx.logger?.info?.(`[elysium-tools] ${tools.length} Model API tools loaded`)
}
