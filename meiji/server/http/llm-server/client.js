import { chatParameters, imageParameters, videoParameters } from './params.js';
import { sendChat, requestTimeoutMs, requestDispatcher } from '../chat-transport.js';
import { recordTransfer } from '../../gateway/gateway-trace.js';
import { publicHeaders, redactJson } from '../../gateway/redact.js';
import { gatewayBaseUrl } from '../../../models/model-config.js';

async function generateImage(options) {
  const { url, headers, body, apiKey } = imageParameters({ ...options, taskId: options.task?.id });
  const { signal, fetchImpl = fetch } = options;
  signal?.throwIfAborted();
  const started = Date.now();
  const transfer = {
    fn: 'generateImage', method: 'POST', path: url.pathname,
    request: { method: 'POST', path: url.pathname, headers: publicHeaders(headers, apiKey), body: redactJson(body, apiKey) },
  };
  const settle = result => recordTransfer(Object.assign(transfer, { durationMs: Date.now() - started, ...result }));
  await recordTransfer(transfer);
  let response, data;
  try {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    response = await fetchImpl(url, {
      method: 'POST', headers, body: JSON.stringify(body), dispatcher: requestDispatcher,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await response.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (error) {
    await settle({ ok: false, status: response?.status ?? null, error: redactJson(error.message, apiKey) });
    throw error;
  }
  await settle({ ok: response.ok, status: response.status, body: redactJson(data, apiKey) });
  signal?.throwIfAborted();
  if (!response.ok) {
    const message = data?.error?.message || (typeof data === 'string' ? data.replace(/\s+/g, ' ').slice(0, 180) : `图片生成失败：HTTP ${response.status}`);
    throw Object.assign(new Error(message), { status: response.status === 401 ? 401 : 502 });
  }
  const encoded = data?.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !encoded.trim()) throw Object.assign(new Error('模型未返回图片'), { status: 502 });
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw Object.assign(new Error('模型返回的图片是空的'), { status: 502 });
  return bytes;
}

async function generateVideo(options) {
  const { url, headers, body, apiKey } = videoParameters({ ...options, taskId: options.task?.id });
  const { signal, fetchImpl = fetch } = options;
  signal?.throwIfAborted();
  const started = Date.now();
  const transfer = {
    fn: 'generateVideo', method: 'POST', path: url.pathname,
    request: { method: 'POST', path: url.pathname, headers: publicHeaders(headers, apiKey), body: redactJson(body, apiKey) },
  };
  const settle = result => recordTransfer(Object.assign(transfer, { durationMs: Date.now() - started, ...result }));
  await recordTransfer(transfer);
  let response, data;
  try {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    response = await fetchImpl(url, {
      method: 'POST', headers, body: JSON.stringify(body), dispatcher: requestDispatcher,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await response.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (error) {
    await settle({ ok: false, status: response?.status ?? null, error: redactJson(error.message, apiKey) });
    throw error;
  }
  await settle({ ok: response.ok, status: response.status, body: redactJson(data, apiKey) });
  signal?.throwIfAborted();
  if (!response.ok) {
    const message = data?.error?.message || (typeof data === 'string' ? data.replace(/\s+/g, ' ').slice(0, 180) : `视频生成失败：HTTP ${response.status}`);
    throw Object.assign(new Error(message), { status: response.status === 401 ? 401 : 502 });
  }
  if (typeof data?.url !== 'string' || !data.url || typeof data.task_id !== 'string' || !data.task_id) {
    throw Object.assign(new Error('模型未返回视频'), { status: 502 });
  }
  const file = await fetchImpl(data.url, {
    dispatcher: requestDispatcher, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]) : AbortSignal.timeout(requestTimeoutMs),
  });
  if (!file.ok) throw Object.assign(new Error(`视频下载失败：HTTP ${file.status}`), { status: 502 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) throw Object.assign(new Error('模型返回的视频是空的'), { status: 502 });
  return { bytes, taskId: data.task_id };
}

export const llmServerClient = Object.freeze({
  complete(options) { return sendChat(chatParameters(options), options); },
  generateImage,
  generateVideo,
  async gpu({ baseUrl, fetchImpl = fetch }) {
    try {
      const response = await fetchImpl(`${gatewayBaseUrl(baseUrl)}/gpu`, {
        headers: { Authorization: 'Bearer ollama' }, dispatcher: requestDispatcher, signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) throw new Error('GPU unavailable');
      return await response.json();
    } catch { throw Object.assign(new Error('GPU 利用率暂不可用'), { status: 503 }); }
  },
});
