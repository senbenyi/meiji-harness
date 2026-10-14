import { chatParameters } from './params.js';
import { sendChat, requestTimeoutMs, requestDispatcher } from '../chat-transport.js';
import { gatewayBaseUrl } from '../../../models/model-config.js';

export const llmServerClient = Object.freeze({
  complete(options) { return sendChat(chatParameters(options), options); },
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
