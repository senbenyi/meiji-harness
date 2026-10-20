import { requestData } from '../request.js';
import { chatParameters, imageParameters, videoParameters } from './params.js';
import { sendChat } from '../chat.js';
import { publicHeaders, redactJson } from '../redact.js';
import { gatewayBaseUrl } from '../connection.js';
import { remoteTaskHeaders, requestRemoteTask } from '../remote-task.js';

function transportOptions(request, options, fn) {
  const { url, headers, body, apiKey } = request;
  const trace = {
    fn, method: 'POST', path: url.pathname,
    request: { method: 'POST', path: options.recovering ? options.resumeFrom : headers.Prefer ? url.href : url.pathname, headers: publicHeaders(headers, apiKey, options), body: redactJson(body, apiKey) },
  };
  return {
    signal: options.signal, trace, retryDelays: options.retryDelays, timeoutMs: options.timeoutMs, dispatcher: options.dispatcher,
    ...(options.record ? { record: options.record } : {}),
    fetchResponse: (signal, dispatcher) => requestRemoteTask(request, {
      ...options, signal, id: options.requestId,
    }, dispatcher),
  };
}

async function requestModel(request, options, fn) {
  return requestData({ ...request, method: 'POST' }, transportOptions(request, options, fn));
}

async function generateImage(options) {
  const { url, headers, body, apiKey } = imageParameters(options);
  Object.assign(headers, remoteTaskHeaders(headers, options.requestId));
  const { response, data } = await requestModel({ url, headers, body, apiKey }, options, 'generateImage');
  if (!response.ok) {
    const message = data?.error?.message || (typeof data === 'string' ? data.replace(/\s+/g, ' ').slice(0, 180) : `图片生成失败：HTTP ${response.status}`);
    throw Object.assign(new Error(message), { status: response.status });
  }
  const encoded = data?.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !encoded.trim()) throw Object.assign(new Error('模型未返回图片'), { status: 502 });
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw Object.assign(new Error('模型返回的图片是空的'), { status: 502 });
  return bytes;
}

async function generateVideo(options) {
  const { url, headers, body, apiKey } = videoParameters(options);
  Object.assign(headers, remoteTaskHeaders(headers, options.requestId));
  const { response, data } = await requestModel({ url, headers, body, apiKey }, options, 'generateVideo');
  if (!response.ok) {
    const message = data?.error?.message || (typeof data === 'string' ? data.replace(/\s+/g, ' ').slice(0, 180) : `视频生成失败：HTTP ${response.status}`);
    throw Object.assign(new Error(message), { status: response.status });
  }
  if (data?.status !== 'succeeded') throw Object.assign(new Error(`视频服务未返回成功状态：${data?.status || '缺少status'}`), { status: 502 });
  if (typeof data?.url !== 'string' || !data.url || typeof data.task_id !== 'string' || !data.task_id) {
    throw Object.assign(new Error('模型未返回视频'), { status: 502 });
  }
  assertVideoUrl(data.url);
  return { taskId: data.task_id, url: data.url };
}

function assertVideoUrl(value) {
  let target;
  try { target = new URL(value); } catch { throw Object.assign(new Error('视频下载地址无效'), { status: 502 }); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw Object.assign(new Error('视频下载地址无效'), { status: 502 });
  return target;
}

export async function downloadRemoteVideo({ url, signal, fetchImpl = fetch, apiKey, record, dispatcher, timeoutMs }) {
  const target = assertVideoUrl(url);
  const downloadPath = `${target.origin}${target.pathname}`;
  const download = { fn: 'downloadVideo', method: 'GET', path: downloadPath, request: { method: 'GET', path: downloadPath, headers: {} } };
  const { data: bytes } = await requestData({ url: target, method: 'GET', apiKey }, {
    signal, fetchImpl, dispatcher, timeoutMs, responseType: 'bytes', trace: download, ...(record ? { record } : {}),
    validateResponse(response) {
      if (!response.ok) throw Object.assign(new Error(`视频下载失败：HTTP ${response.status}`), { status: 502 });
    },
    validateData(bytes) {
      signal?.throwIfAborted();
      if (!bytes.length) throw Object.assign(new Error('模型返回的视频是空的'), { status: 502 });
    },
  });
  return bytes;
}

export const modelClient = Object.freeze({
  complete(options) {
    const request = chatParameters(options);
    return sendChat(request, transportOptions(request, options, 'sendChat'));
  },
  generateImage,
  generateVideo,
  downloadVideo: downloadRemoteVideo,
  async gpu({ baseUrl, fetchImpl = fetch, apiKey = 'ollama', signal, dispatcher, timeoutMs }) {
    try {
      const { data } = await requestData({ url: `${gatewayBaseUrl(baseUrl)}/gpu`, headers: { Authorization: `Bearer ${apiKey}` } }, {
        fetchImpl, signal, dispatcher, timeoutMs, record: async () => {},
        validateResponse(response) { if (!response.ok) throw new Error('GPU unavailable'); },
      });
      return data;
    } catch { throw Object.assign(new Error('GPU 利用率暂不可用'), { status: 503 }); }
  },
});
