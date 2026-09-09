import { MODEL_TIMEOUTS } from '../common/task.js'
import { runMediaJob } from '../../workflows/media-jobs.js'
import { completedModelTool } from '../common/tool.js'

export function createModelConcatVideoTool() {
  return completedModelTool({
    name: 'model_concat_video',
    description: '将已有 MP4 按镜头顺序合为一个成片，保留原音轨；不重新生成。要求编码、尺寸、帧率及音轨规格一致，返回成片路径和解码、时长验证结果。导演工作流已经合成的成片无需再次合并。',
    timeoutMs: MODEL_TIMEOUTS.postprocess,
    parameters: {
      properties: {
        video_paths: { type: 'array', minItems: 2, items: { type: 'string' }, description: '按镜头顺序排列的共享 artifacts 内 MP4 绝对路径，使用已完成任务返回的 path。' },
      },
      required: ['video_paths'],
    },
    execute: (args, signal, exec) => runMediaJob('video-concat', { video_paths: args.video_paths }, exec),
  })
}
