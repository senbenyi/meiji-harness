import { setTimeout as delay } from 'node:timers/promises';
import { requestData } from './request.js';
import { publicHeaders, redactJson } from './redact.js';

// 解析兼容的非流式文本/工具响应；不选择模型，不添加提示词或采样参数。
export async function sendChat(request, { signal, retryDelays = [1000, 3000], returnMessage = false, ...options } = {}) {
  for (const [attempt, wait] of [0, ...retryDelays].entries()) {
    if (attempt) await delay(wait, undefined, { signal });
    const trace = options.trace ? structuredClone(options.trace) : {
      fn: 'sendChat', method: 'POST', path: new URL(request.url).pathname,
      request: { method: 'POST', path: request.headers?.Prefer ? String(request.url) : new URL(request.url).pathname,
        headers: publicHeaders(request.headers, request.apiKey, options), body: redactJson(request.body, request.apiKey) },
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
    if (finish && finish !== 'stop' && !(returnMessage && finish === 'tool_calls')) throw Object.assign(new Error(`模型输出未正常完成：${finish}`), { status: 502, code: 'INCOMPLETE_MODEL_OUTPUT' });
    if (returnMessage) {
      const message = data?.choices?.[0]?.message;
      const calls = message?.tool_calls;
      if (calls !== undefined && (!Array.isArray(calls) || calls.length > 64)) throw new Error('模型工具调用格式无效');
      const ids = new Set();
      for (const call of calls || []) {
        if (!call || typeof call.id !== 'string' || !call.id || ids.has(call.id) || call.type !== 'function'
          || typeof call.function?.name !== 'string' || !call.function.name || typeof call.function.arguments !== 'string') throw new Error('模型工具调用格式无效');
        ids.add(call.id);
      }
      if (finish === 'tool_calls' && !calls?.length) throw new Error('模型工具调用缺失');
      if (!calls?.length && (typeof message?.content !== 'string' || !message.content.trim())) throw new Error('模型没有返回文本或工具调用');
      if (message.content != null && typeof message.content !== 'string') throw new Error('模型消息正文无效');
      return { role: 'assistant', content: message.content ?? null, ...(calls?.length ? { tool_calls: structuredClone(calls) } : {}) };
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('模型没有返回文本'), { status: 502 });
    return content.trim();
  }
}
