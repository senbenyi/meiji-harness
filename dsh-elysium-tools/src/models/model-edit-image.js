import { MODEL_TIMEOUTS, runModelTask } from './model-task.js'
import { completedModelTool } from './model-tool.js'

export function createModelEditImageTool() {
  return completedModelTool({
    name: 'model_edit_image',
    description: '创建、重制或清理图片水印，等待任务完成后返回产物路径。',
    timeoutMs: MODEL_TIMEOUTS.image,
    parameters: {
      properties: {
        operation: { type: 'string', enum: ['create', 'remake', 'watermark_cleanup'], description: '编辑操作。' },
        image_path: { type: 'string', description: '共享 artifacts 目录下的图片绝对路径。' },
        prompt: { type: 'string', description: 'create/remake 使用的画面描述。' },
        seed: { type: 'number', description: '随机种子，默认 666。' },
      },
      required: ['operation'],
    },
    execute: (args, signal) => runModelTask('image-edit', {
        operation: args.operation,
        image_path: args.image_path,
        prompt: args.prompt,
        seed: args.seed ?? 666,
      }, signal, MODEL_TIMEOUTS.image),
  })
}
