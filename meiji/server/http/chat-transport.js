import { setTimeout as delay } from 'node:timers/promises';
import { recordTransfer } from '../gateway/gateway-trace.js';
import { publicHeaders, redactJson } from '../gateway/redact.js';

export async function sendChat(request, { signal, fetchImpl = fetch, retryDelays = [1000, 3000] } = {}) {
  const { url, headers, body, apiKey } = request;
  for (const [attempt, wait] of [0, ...retryDelays].entries()) {
    if (attempt) await delay(wait, undefined, { signal });
    signal?.throwIfAborted();
    const started = Date.now();
    let response, data;
    const record = (result) => recordTransfer({
      fn: 'sendChat', method: 'POST', path: url.pathname,
      request: { method: 'POST', path: url.pathname, headers: publicHeaders(headers, apiKey), body: redactJson(body, apiKey) },
      durationMs: Date.now() - started, ...result,
    });
    try {
      const timeout = AbortSignal.timeout(15 * 60 * 1000);
      response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      const text = await response.text();
      try { data = JSON.parse(text); } catch { data = text; }
    } catch (error) {
      await record({ ok: false, status: response?.status ?? null, error: redactJson(error.message, apiKey) });
      throw error;
    }
    await record({ ok: response.ok, status: response.status, body: redactJson(data, apiKey) });
    signal?.throwIfAborted();
    if (!response.ok) {
      if ([502, 503, 504].includes(response.status) && attempt < retryDelays.length) continue;
      const message = data?.error?.message || (typeof data === 'string' ? data.replace(/\s+/g, ' ').slice(0, 180) : `文本生成失败：HTTP ${response.status}`);
      throw Object.assign(new Error(redactJson(message, apiKey)), { status: response.status === 401 ? 401 : 502 });
    }
    const finish = data?.choices?.[0]?.finish_reason;
    if (finish && finish !== 'stop') throw Object.assign(new Error(`模型输出未正常完成：${finish}`), { status: 502, code: 'INCOMPLETE_MODEL_OUTPUT' });
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('模型没有返回文本'), { status: 502 });
    return content.trim();
  }
}
