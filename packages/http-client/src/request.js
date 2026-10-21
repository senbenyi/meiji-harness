import { getGlobalDispatcher } from 'undici';
import { recordTransfer } from './trace.js';
import { publicHeaders, redactJson } from './redact.js';

export const requestTimeoutMs = 60 * 60 * 1000;
export function createDispatcher(timeoutMs = requestTimeoutMs) {
  return {
    dispatch(options, handler) {
      return getGlobalDispatcher().dispatch({ ...options, headersTimeout: timeoutMs, bodyTimeout: timeoutMs }, handler);
    },
  };
}
export const requestDispatcher = createDispatcher();

// fetchResponse 可接入异步任务协议；record 可直接接入任意项目的步骤记录。
// HTTP 错误作为结果返回，由调用方解释业务错误；网络/读取异常原样抛出。
export async function requestData(request, {
  signal, fetchImpl = fetch, fetchResponse,
  timeoutMs = requestTimeoutMs, dispatcher = requestDispatcher,
  responseType = 'json', trace, record = recordTransfer,
  keepRecord = () => true, emptyBodyValue = '',
  validateResponse = () => {}, validateData = () => {},
  sensitiveHeaders,
} = {}) {
  signal?.throwIfAborted();
  const { url, headers, body, apiKey, logBody, redirect, fn } = request;
  const method = request.method || (body === undefined ? 'GET' : 'POST');
  const form = body instanceof FormData;
  const address = new URL(url);
  const transfer = trace || {
    fn, title: request.title, method, path: address.pathname,
    request: { method, path: address.pathname, headers: publicHeaders(headers, apiKey, { sensitiveHeaders }), body: redactJson(form ? logBody : body, apiKey) },
  };
  const started = Date.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const options = {
    method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    signal: activeSignal, ...(dispatcher ? { dispatcher } : {}), ...(redirect ? { redirect } : {}),
  };
  await record(transfer);
  let response, data;
  try {
    response = fetchResponse ? await fetchResponse(activeSignal, dispatcher) : await fetchImpl(url, options);
    validateResponse(response);
    if (responseType === 'bytes' && response.ok) data = Buffer.from(await response.arrayBuffer());
    else {
      const text = await response.text();
      try { data = text ? JSON.parse(text) : emptyBodyValue; } catch { data = text; }
    }
    validateData(data, response);
  } catch (error) {
    await record(Object.assign(transfer, { durationMs: Date.now() - started, ok: false, status: response?.status ?? null, error: redactJson(error.message, apiKey) }));
    throw error;
  }
  const result = { ok: response.ok, response, data, durationMs: Date.now() - started };
  if (keepRecord(result)) await record(Object.assign(transfer, {
    durationMs: result.durationMs, ok: response.ok, status: response.status,
    ...(Buffer.isBuffer(data) ? { bytes: data.length } : { body: redactJson(data, apiKey) }),
  }));
  else await record(transfer, { drop: true });
  signal?.throwIfAborted();
  return result;
}
