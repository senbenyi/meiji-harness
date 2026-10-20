import { setTimeout as delay } from 'node:timers/promises';

export function remoteTaskHeaders(headers, requestId) {
  return requestId ? { ...headers, 'X-Task-ID': requestId, 'Idempotency-Key': requestId, Prefer: 'respond-async' } : headers;
}

// llm-server 异步任务协议。调用方须先持久化请求标识；恢复只查询，不重新提交。
export async function requestRemoteTask(request, options, dispatcher) {
  const { fetchImpl = fetch, signal, id, recovering = false, resumeFrom, shouldStop = () => false, pollIntervalMs = 5000 } = options;
  if (recovering && (!resumeFrom || typeof id !== 'string' || !id || request.headers.Prefer !== 'respond-async')) {
    throw new Error('没有可恢复的服务端请求记录或请求标识，未重新生成');
  }
  if (request.headers.Prefer !== 'respond-async') {
    return fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), dispatcher, signal });
  }
  const prior = recovering ? resumeFrom : null;
  if (recovering && !prior) throw new Error('没有可恢复的服务端请求记录，未重新生成');
  const source = prior ? new URL(prior) : new URL(request.url);
  if (typeof id !== 'string' || !id) throw new Error('异步请求需要稳定请求标识');
  const address = new URL(`../tasks/${encodeURIComponent(id)}`, source);
  const headers = { Authorization: request.headers.Authorization };
  const stop = () => {
    if (!shouldStop(signal?.reason)) return;
    void fetchImpl(`${address}/stop`, { method: 'POST', headers, dispatcher, signal: AbortSignal.timeout(10000) }).catch(() => {});
  };
  signal?.throwIfAborted();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    if (!prior) {
      try {
        const response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), dispatcher, signal });
        if (response.status !== 202 && response.status !== 409) return response;
        await response.arrayBuffer();
      } catch (error) {
        signal?.throwIfAborted();
        // 受理响应可能丢失，先按同一请求号核对，不能创建另一个生成。
      }
    }
    for (;;) {
      signal?.throwIfAborted();
      let response, state;
      try {
        response = await fetchImpl(address, { headers, dispatcher, signal });
        if (response.status >= 500) { await delay(pollIntervalMs, undefined, { signal }); continue; }
        if (response.ok) state = await response.json();
      } catch (error) {
        signal?.throwIfAborted();
        await delay(pollIntervalMs, undefined, { signal });
        continue;
      }
      if (response.status === 404) throw new Error('服务端任务记录不存在或已过期，未重新生成');
      if (!response.ok) throw new Error(`查询服务端任务失败：HTTP ${response.status}`);
      if (state.status === 'succeeded') {
        let result;
        try { result = await fetchImpl(`${address}/result`, { headers, dispatcher, signal }); }
        catch (error) {
          signal?.throwIfAborted();
          await delay(pollIntervalMs, undefined, { signal });
          continue;
        }
        if (result.status === 404) throw new Error('服务端任务已完成，但结果已过期或未保留，未重新生成');
        if (result.status >= 500) { await delay(pollIntervalMs, undefined, { signal }); continue; }
        return result;
      }
      if (['failed', 'cancelled', 'interrupted'].includes(state.status)) throw new Error(state.error || `服务端任务已停止：${state.status}`);
      if (!['queued', 'running'].includes(state.status)) throw new Error('服务端返回未知任务状态');
      await delay(pollIntervalMs, undefined, { signal });
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally { signal?.removeEventListener('abort', stop); }
}
