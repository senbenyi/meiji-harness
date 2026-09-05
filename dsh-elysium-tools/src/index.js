import { createModelGenerateImageTool } from './workflows/model-generate-image.js'

export { ModelApiError, createModelApiService } from './models/model-api.js'
export { createModelGenerateImageTool } from './workflows/model-generate-image.js'

export const name = '@dsh-external/dsh-elysium-tools'
export const inject = ['tools']

export function apply(ctx) {
  const tool = createModelGenerateImageTool()
  if (typeof ctx.effect === 'function' && typeof ctx.tools?.register === 'function') {
    ctx.effect(() => ctx.tools.register(tool), '@dsh-external/dsh-elysium-tools: model_generate_image tool')
  } else if (typeof ctx.tools?.register === 'function') {
    ctx.tools.register(tool)
  }
  ctx.logger?.info?.('[elysium-tools] Model API tools loaded')
}

