import { MODEL_TIMEOUTS, runModelTask } from '../common/task.js'
import { completedModelTool } from '../common/tool.js'

export function createModelGenerateVideoTool() {
  return completedModelTool({
    name: 'model_generate_video',
    description: '生成不超过 15 秒的短视频：文字、起始图片或参考素材生成；超过 15 秒使用 model_generate_video_long。模型由路由决定，默认保留原生帧率和音轨。',
    timeoutMs: MODEL_TIMEOUTS.video,
    parameters: {
      properties: {
        mode: { type: 'string', enum: ['text', 'image', 'reference'], description: 'text：文字生成视频；image：起始图片生成视频；reference：参考图片、视频或音频生成视频。是否带声音由执行模型决定。' },
        prompt: { type: 'string', description: '画面、动作及所需声音描述。' },
        duration: { type: 'integer', minimum: 1, maximum: 15, description: '短视频秒数，默认 5；15 秒仍属于短视频。' },
        image_path: { type: 'string', description: '共享 artifacts 下图片绝对路径；image 模式必填。' },
        video_path: { type: 'string', description: '共享 artifacts 下参考视频绝对路径；仅 reference 模式。' },
        audio_path: { type: 'string', description: '共享 artifacts 下参考音频绝对路径；仅 reference 模式。' },
        seed: { type: 'integer', minimum: 0, description: '随机种子，默认 666。' },
      },
      required: ['mode', 'prompt'],
    },
    execute: (args, signal) => runModelTask('video-generate', {
      mode: args.mode, prompt: args.prompt, duration: args.duration ?? 5, image_path: args.image_path,
      video_path: args.video_path, audio_path: args.audio_path, seed: args.seed ?? 666,
    }, signal, MODEL_TIMEOUTS.video),
  })
}
