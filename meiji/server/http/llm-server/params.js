import { gatewayBaseUrl } from '../../../models/model-config.js';

export function chatParameters({ baseUrl, model, system, prompt }) {
  if (model !== 'qwen3.5:27b') throw Object.assign(new Error('llm-server 文本模型无效'), { status: 400 });
  // 部署采样参数由 llm-server 补齐，不携带媒体网关密钥。
  return {
    url: new URL(`${gatewayBaseUrl(baseUrl)}/chat/completions`),
    apiKey: 'ollama',
    headers: { Authorization: 'Bearer ollama', 'Content-Type': 'application/json' },
    body: { model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], stream: false },
  };
}
