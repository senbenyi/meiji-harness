import { sendChat as sendTransportChat } from '@agent-modules/http-client';
import { taskRequest, recoverableRequest } from './llm-server/task-request.js';
export { requestTimeoutMs, requestDispatcher } from '@agent-modules/http-client';

// 保留 meiji 的 step 适配，传输包不依赖任务/项目模型。
export function sendChat(request, options = {}) {
  const { step, record: stepRecord, ...transport } = options;
  const prior = step?.recovering ? recoverableRequest(step) : null;
  return sendTransportChat(request, {
    ...transport, ...(prior ? { trace: prior } : {}),
    fetchResponse: (signal, dispatcher) => taskRequest(request, { ...options, signal }, dispatcher),
  });
}
