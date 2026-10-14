import { invalid } from '../../shared/task_contract.js';
import storyboard from './nodes/storyboard.js';
import { parseSections } from '../prompts/parse-sections.js';
import { videoParameters } from './elysium/video-params.js';

// 程序编排：只使用已审核三段，不调用文本模型，不推断业务类型。
export function videoRequest(input, action = 'generate') {
  const keys = storyboard.actions.generate.output.sections;
  const parts = typeof input.textPrompt === 'string' ? parseSections(input.textPrompt, keys) : input.textPrompt;
  if (!parts || Object.keys(parts).length !== keys.length || keys.some(key => typeof parts[key] !== 'string' || !parts[key].trim()))
    invalid('输入.textPrompt', '需包含三个非空段落');
  const modes = { '文生': 'text', '首尾帧': 'first_frame', '多模态': 'reference' };
  if (!Object.hasOwn(modes, input.type)) invalid('输入.type', '需为文生、首尾帧或多模态');
  let body = typeof input.textPrompt === 'string' ? input.textPrompt : keys.map(key => `${key}:\n${parts[key]}`).join('\n\n');
  if (input.type === '首尾帧') body = "<Picture 1> aligns with 0.00 seconds. It is the previous shot's last frame.\n\n" + body;
  if (action === 'regenerate') {
    if (typeof input.opinion !== 'string' || !input.opinion.trim()) invalid('输入.opinion', '修订意见不能为空');
    body += `\n\nRevision instructions:\n${input.opinion}`;
  }
  const request = { mode: modes[input.type], duration: input.duration, aspectRatio: input.aspectRatio, prompt: body,
    ...(input.firstFrame !== undefined ? { inputReference: input.firstFrame } : {}),
    ...(input.referenceImages !== undefined ? { referenceImages: [...input.referenceImages] } : {}) };
  videoParameters({ model: 'elysium-video', ...request });
  return request;
}
