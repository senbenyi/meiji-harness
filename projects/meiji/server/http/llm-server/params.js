import {
  chatParameters as buildChatParameters, imageParameters as buildImageParameters,
  videoParameters as buildVideoParameters,
} from '@agent-modules/http-client/model-parameters';
export { gptImagePrompt, videoPayload } from '@agent-modules/http-client/model-parameters';

// 旧 meiji 调用签名保留；公共协议只接收显式 requestId。
export function chatParameters({ step, ...options }) {
  return buildChatParameters({ ...options, apiKey: 'ollama', requestId: step?.id });
}

export const imageParameters = options => buildImageParameters({ ...options, apiKey: 'ollama' });
export const videoParameters = options => buildVideoParameters({ ...options, apiKey: 'ollama' });
