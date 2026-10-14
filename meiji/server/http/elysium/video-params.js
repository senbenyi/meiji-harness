import { invalid } from '../../../shared/task_contract.js';
import { videoSizeOf } from '../../../shared/media-parameters.js';

// Elysium 视频协议白名单；不得从素材猜类型或修正调用方的时长。
export function videoParameters({ model, prompt, duration, aspectRatio, mode, inputReference, referenceImages }) {
  if (typeof prompt !== 'string' || !prompt.trim()) invalid('视频.prompt', '不能为空');
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) invalid('视频.duration', '需为4–15之间的整数秒');
  if (!['text', 'first_frame', 'reference'].includes(mode)) invalid('视频.mode', '需明确指定类型');
  const image = (value, allowBase64 = false) => {
    if (typeof value !== 'string' || !(allowBase64 ? /^(?:data:image\/(?:png|jpeg|webp);base64,)?[A-Za-z0-9+/]+={0,2}$/ : /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).test(value) || !Buffer.from(value.replace(/^data:[^,]+,/, ''), 'base64').length) invalid('视频.图片', '需为非空 PNG、JPEG 或 WebP base64 data URL');
  };
  const body = { model, prompt, seconds: String(duration), size: videoSizeOf(aspectRatio) };
  if (mode === 'reference') {
    if (!Array.isArray(referenceImages) || !referenceImages.length || referenceImages.length > 9) invalid('视频.referenceImages', '需为1–9张参考图');
    referenceImages.forEach(value => image(value));
    body.reference_images = [...referenceImages];
  } else if (referenceImages !== undefined) invalid('视频.referenceImages', '仅多模态允许');
  if (mode === 'first_frame') {
    image(inputReference, true);
    body.input_reference = inputReference;
  } else if (inputReference !== undefined) invalid('视频.inputReference', '仅首尾帧允许');
  return body;
}
