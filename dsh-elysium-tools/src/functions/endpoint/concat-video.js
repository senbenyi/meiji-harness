import { MODEL_TIMEOUTS } from '../../jobs/contracts.js'
import { runMediaJob } from '../../workflows/media-jobs.js'
import { completedModelTool } from '../common/tool.js'

export function createModelConcatVideoTool() {
  return completedModelTool({
    name: 'model_concat_video',
    description: '将已有 MP4 按镜头顺序合为一个成片，保留原音轨；不重新生成。要求编码、尺寸、帧率及音轨规格一致，根据最终节点 history 返回成片播放 URL；输出完整解码、规格匹配和人工验收均未执行。导演工作流已经合成的成片无需再次合并。',
    timeoutMs: MODEL_TIMEOUTS.concat,
    parameters: {
      properties: {
        video_paths: { type: 'array', minItems: 2, items: { type: 'string' }, description: '按镜头顺序排列的ComfyUI HTTP view 视频地址，使用已完成任务返回的 path。' },
      },
      required: ['video_paths'],
    },
    execute: (args, signal, exec) => runMediaJob('video-concat', { video_paths: args.video_paths }, exec),
  })
}
