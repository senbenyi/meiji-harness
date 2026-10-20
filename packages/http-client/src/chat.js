import { setTimeout as delay } from 'node:timers/promises';
import { requestData } from './request.js';
import { publicHeaders, redactJson } from './redact.js';

// 仅解析 OpenAI 兼容的非流式文本响应；不选择模型，不添加提示词或采样参数。
export async function sendChat(request, { signal, retryDelays = [1000, 3000], ...options } = {}) {
  for (const [attempt, wait] of [0, ...retryDelays].entries()) {
    if (attempt) await delay(wait, undefined, { signal });
    const trace = options.trace ? structuredClone(options.trace) : {
      fn: 'sendChat', method: 'POST', path: new URL(request.url).pathname,
      request: { method: 'POST', path: request.headers?.Prefer ? String(request.url) : new URL(request.url).pathname,
        headers: publicHeaders(request.headers, request.apiKey), body: redactJson(request.body, request.apiKey) },
    };
    const { response, data } = await requestData({ ...request, method: 'POST', fn: 'sendChat' }, {
      ...options, signal, trace,
    });
    if (!response.ok) {
      if (!request.headers?.Prefer && [502, 503, 504].includes(response.status) && attempt < retryDelays.length) continue;
      const message = data?.error?.message || (typeof data === 'string' ? data.replace(/\s+/g, ' ').slice(0, 180) : `文本生成失败：HTTP ${response.status}`);
      throw Object.assign(new Error(redactJson(message, request.apiKey)), { status: response.status });
    }
    const finish = data?.choices?.[0]?.finish_reason;
    if (finish && finish !== 'stop') throw Object.assign(new Error(`模型输出未正常完成：${finish}`), { status: 502, code: 'INCOMPLETE_MODEL_OUTPUT' });
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('模型没有返回文本'), { status: 502 });
    return content.trim();
  }
}
