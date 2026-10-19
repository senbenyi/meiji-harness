import { PROJECT_ASPECT_RATIOS } from '../../../shared/media-parameters.js';
import { gatewayBaseUrl } from '../../../models/model-config.js';
import { taskHeaders } from './task-request.js';

const frames = { '16:9': '横版 16:9', '9:16': '竖版 9:16' };
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
  const aspect = aspectRatio || '1:1';
  if (!PROJECT_ASPECT_RATIOS.includes(aspect)) throw Object.assign(new Error('画幅不受支持'), { status: 400 });
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

const videoModes = { text: '文生', first_frame: '首尾帧', reference: '多模态' }

// 三种方式都调用 MiniMax-H3。mode 只用文生、首尾帧、多模态；比例规则随方式变化。
export function videoPayload({ model, prompt, duration, aspectRatio, mode, inputReference, lastFrame, referenceImages }) {
  if (model !== 'MiniMax-H3') throw Object.assign(new Error('llm-server 视频模型无效'), { status: 400 })
  const kind = videoModes[mode]
  if (!kind) throw Object.assign(new Error('视频方式必须是文生、首尾帧或多模态'), { status: 400 })
  if (typeof prompt !== 'string' || !prompt.trim()) throw Object.assign(new Error('需要非空提示词'), { status: 400 })
  if (prompt.length > 7000) throw Object.assign(new Error('提示词最长 7000 个字符'), { status: 400 })
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) throw Object.assign(new Error('时长必须是 4 到 15 的整数秒'), { status: 400 })
  const ratio = PROJECT_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : undefined
  const body = { mode: kind, prompt, duration, resolution: '768P' }
  const image = value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 48 * 1024 * 1024 ||
        !(/^(?:https:\/\/|mm_file:\/\/)/i.test(value) || /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/i.test(value))) {
      throw Object.assign(new Error('视频图片需为 https、mm_file 或非空 image data URL'), { status: 400 })
    }
    return value
  }
  if (kind === '文生') {
    if (inputReference !== undefined || lastFrame !== undefined || referenceImages !== undefined) throw Object.assign(new Error('文生视频不能带画面素材'), { status: 400 })
    if (!ratio) throw Object.assign(new Error('文生视频画幅不受支持'), { status: 400 })
    body.ratio = ratio
  } else if (kind === '首尾帧') {
    if (referenceImages !== undefined) throw Object.assign(new Error('首尾帧不能带参考素材'), { status: 400 })
    body.first_frame = image(inputReference)
    if (lastFrame !== undefined) body.last_frame = image(lastFrame)
    body.ratio = 'adaptive'
  } else {
    if (inputReference !== undefined || lastFrame !== undefined) throw Object.assign(new Error('多模态不能带首尾帧'), { status: 400 })
    if (!Array.isArray(referenceImages) || !referenceImages.length || referenceImages.length > 9) throw Object.assign(new Error('多模态需要 1 到 9 张参考图'), { status: 400 })
    body.images = referenceImages.map(image)
    if (aspectRatio !== undefined && aspectRatio !== 'adaptive' && !ratio) throw Object.assign(new Error('多模态视频画幅不受支持'), { status: 400 })
    body.ratio = ratio || 'adaptive'
  }
  return body
}

export function videoParameters(options) {
  const { baseUrl, taskId } = options
  return {
    url: new URL(`${gatewayBaseUrl(baseUrl)}/videos/generations`),
    apiKey: 'ollama',
    headers: requestHeaders(taskId),
    body: videoPayload(options),
  }
}

export function chatParameters({ baseUrl, model, messages, step }) {
  if (!['qwen3.5:27b', 'codex-gpt'].includes(model)) throw Object.assign(new Error('llm-server 文本模型无效'), { status: 400 });
  // 部署采样参数由 llm-server 补齐，不携带媒体网关密钥。
  return {
    url: new URL(`${gatewayBaseUrl(baseUrl)}/chat/completions`),
    apiKey: 'ollama',
    headers: taskHeaders({ Authorization: 'Bearer ollama', 'Content-Type': 'application/json' }, step),
    body: { model, messages: structuredClone(messages), stream: false },
  };
}
