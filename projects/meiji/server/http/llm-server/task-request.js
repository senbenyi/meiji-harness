import { requestRemoteTask } from '@agent-modules/http-client/remote-task';

export function taskHeaders(headers, step) {
  return step?.id ? { ...headers, 'X-Task-ID': step.id, 'Idempotency-Key': step.id, Prefer: 'respond-async' } : headers;
}

export function recoverableRequest(step) {
  return step?.http?.find(row => row.request?.headers?.Prefer === 'respond-async' && row.request.headers['X-Task-ID'] === step.id);
}

// step 和业务取消原因只在 meiji 边界解释，通用协议不读取任务模型。
export async function taskRequest(request, options, dispatcher) {
  const { step, ...transport } = options;
  const prior = step?.recovering ? recoverableRequest(step) : null;
  if (step?.recovering && !prior) throw new Error('此步骤没有可恢复的服务端请求记录，未重新生成');
  return requestRemoteTask(request, {
    ...transport, id: step?.id, recovering: Boolean(step?.recovering), resumeFrom: prior?.request.path,
    shouldStop: reason => /用户取消|项目正在删除/.test(reason?.message || ''),
  }, dispatcher);
}
