import { gatewayBaseUrl } from '../../../models/model-config.js';

export function chatParameters({ baseUrl, apiKey, model, messages }) {
  const key = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) throw Object.assign(new Error('需要网关密钥'), { status: 400 });
  if (model !== 'elysium-chat') throw Object.assign(new Error('Elysium 文本模型无效'), { status: 400 });
  return {
    url: new URL(`${gatewayBaseUrl(baseUrl)}/chat/completions`),
    apiKey: key,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: { model, messages: structuredClone(messages), stream: false },
  };
}
