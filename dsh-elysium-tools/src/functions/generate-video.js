import { MODEL_TIMEOUTS, runModelTask } from './task.js'
import { completedModelTool } from './tool.js'

export function createModelGenerateVideoTool() {
  return completedModelTool({
    name: 'model_generate_video',
    description: '生成视频：文字生成、起始图片生成或参考素材生成；执行模型由路由配置决定。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        mode: { type: 'string', enum: ['text', 'image', 'reference'], description: 'text：文字生成视频；image：起始图片生成视频；reference：参考图片、视频或音频生成视频。是否带声音由执行模型决定。' },
        prompt: { type: 'string', description: '画面、动作及所需声音描述。' },
        image_path: { type: 'string', description: '共享 artifacts 下图片绝对路径；image 模式必填。' },
        video_path: { type: 'string', description: '共享 artifacts 下参考视频绝对路径；仅 reference 模式。' },
        audio_path: { type: 'string', description: '共享 artifacts 下参考音频绝对路径；仅 reference 模式。' },
        seed: { type: 'integer', minimum: 0, description: '随机种子，默认 666。' },
      },
      required: ['mode', 'prompt'],
    },
    execute: (args, signal) => runModelTask('video-generate', {
      mode: args.mode, prompt: args.prompt, image_path: args.image_path,
      video_path: args.video_path, audio_path: args.audio_path, seed: args.seed ?? 666,
    }, signal, MODEL_TIMEOUTS.video),
  })
}
