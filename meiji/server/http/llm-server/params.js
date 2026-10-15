import { gatewayBaseUrl } from '../../../models/model-config.js';

const frames = { '1344x768': '横版 16:9', '768x1344': '竖版 9:16' };
const kreaAspects = { '1344x768': '16:9', '768x1344': '9:16', '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '4:3': '4:3', '3:4': '3:4', '3:2': '3:2', '2:3': '2:3' };
const kreaImageModel = 'krea2 turbo V2.5';

// Codex 文生图的 size 固定为 auto，项目画幅只能写进提示词。
export function gptImagePrompt(prompt, aspectRatio) {
  const frame = frames[aspectRatio];
  if (frame) return `${prompt}\n\n画面为${frame}。`;
  if (aspectRatio && aspectRatio !== 'auto') return `${prompt}\n\n画面比例为 ${aspectRatio}。`;
  return prompt;
}

function requestHeaders(taskId) {
  const headers = { Authorization: 'Bearer ollama', 'Content-Type': 'application/json' };
  if (typeof taskId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(taskId)) headers['X-Task-ID'] = taskId;
  return headers;
}

function kreaImageParameters({ baseUrl, prompt, aspectRatio, quality = 'normal', taskId }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw Object.assign(new Error('需要非空提示词'), { status: 400 });
  if (prompt.length > 8000) throw Object.assign(new Error('提示词最长 8000 个字符'), { status: 400 });
  const aspect = aspectRatio ? kreaAspects[aspectRatio] : '1:1';
  if (!aspect) throw Object.assign(new Error('画幅不受支持'), { status: 400 });
  if (!['low', 'normal', 'high', '低', '正常', '高清'].includes(quality)) throw Object.assign(new Error('质量不受支持'), { status: 400 });
  return {
    url: new URL(`${gatewayBaseUrl(baseUrl)}/images/comfy`),
    apiKey: 'ollama',
    headers: requestHeaders(taskId),
    body: { model: kreaImageModel, prompt, quality, aspect },
  };
}

export function imageParameters({ baseUrl, model, prompt, aspectRatio, quality, references = [], taskId }) {
  if (model === kreaImageModel) return kreaImageParameters({ baseUrl, prompt, aspectRatio, quality, taskId });
  if (model !== 'gpt-image') throw Object.assign(new Error('llm-server 图片模型无效'), { status: 400 });
  if (typeof prompt !== 'string' || !prompt.trim()) throw Object.assign(new Error('需要非空提示词'), { status: 400 });
  if (!Array.isArray(references) || references.length > 5) throw Object.assign(new Error('参考图最多 5 张'), { status: 400 });
  const images = references.map(item => {
    if (!item?.bytes?.length) throw Object.assign(new Error('参考图不能为空'), { status: 400 });
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(item.mime)) throw Object.assign(new Error('参考图需为 PNG、JPG 或 WebP'), { status: 400 });
    return { image_url: `data:${item.mime};base64,${Buffer.from(item.bytes).toString('base64')}` };
  });
  const text = gptImagePrompt(prompt, aspectRatio);
  if (text.length > 32000) throw Object.assign(new Error('提示词最长 32000 个字符'), { status: 400 });
  return {
    url: new URL(`${gatewayBaseUrl(baseUrl)}/images/generations`),
    apiKey: 'ollama',
    headers: requestHeaders(taskId),
    body: {
      model: 'gpt-image', prompt: text, background: 'auto', n: 1, size: 'auto', quality: 'auto', output_format: 'png',
      ...(images.length ? { images } : {}),
    },
  };
}

export function chatParameters({ baseUrl, model, messages }) {
  if (!['qwen3.5:27b', 'codex-gpt'].includes(model)) throw Object.assign(new Error('llm-server 文本模型无效'), { status: 400 });
  // 部署采样参数由 llm-server 补齐，不携带媒体网关密钥。
  return {
    url: new URL(`${gatewayBaseUrl(baseUrl)}/chat/completions`),
    apiKey: 'ollama',
    headers: { Authorization: 'Bearer ollama', 'Content-Type': 'application/json' },
    body: { model, messages: structuredClone(messages), stream: false },
  };
}
