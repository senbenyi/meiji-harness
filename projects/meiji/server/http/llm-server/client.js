import { modelClient } from '@agent-modules/http-client';
import { recoverableRequest } from './task-request.js';
export { videoContentAddress, isGatewayContentAddress } from '@agent-modules/http-client/model-parameters';

// meiji 只映射任务上下文；文本/图片/视频协议及请求执行由公共模块提供。
function transportOptions(options) {
  const { step, task, record: stepRecord, ...transport } = options;
  const prior = step?.recovering ? recoverableRequest(step) : null;
  return {
    ...transport, apiKey: 'ollama', taskId: task?.id ?? transport.taskId, requestId: step?.id,
    recovering: Boolean(step?.recovering), resumeFrom: prior?.request.path,
    shouldStop: reason => /用户取消|项目正在删除/.test(reason?.message || ''),
  };
}

export async function downloadRemoteVideo(options) {
  return modelClient.downloadVideo(transportOptions(options));
}

export const llmServerClient = Object.freeze({
  complete: options => modelClient.complete(transportOptions(options)),
  generateImage: options => modelClient.generateImage(transportOptions(options)),
  generateVideo: options => modelClient.generateVideo(transportOptions(options)),
  downloadVideo: downloadRemoteVideo,
  gpu: options => modelClient.gpu(transportOptions(options)),
});
