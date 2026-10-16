import { invalid } from '../../shared/task_contract.js';
import storyboard from './nodes/storyboard.js';
import { parseSections } from '../prompts/parse-sections.js';
import { videoPayload } from './llm-server/params.js';

// 程序编排：只使用已审核三段，不调用文本模型，不推断业务类型。
export function videoRequest(input, action = 'generate') {
  const keys = storyboard.actions.generate.output.sections;
  const parts = typeof input.textPrompt === 'string' ? parseSections(input.textPrompt, keys) : input.textPrompt;
  if (!parts || Object.keys(parts).length !== keys.length || keys.some(key => typeof parts[key] !== 'string' || !parts[key].trim()))
    invalid('输入.textPrompt', '需包含三个非空段落');
  const modes = { '文生': 'text', '首尾帧': 'first_frame', '多模态': 'reference' };
  if (!Object.hasOwn(modes, input.type)) invalid('输入.type', '需为文生、首尾帧或多模态');
  let body = typeof input.textPrompt === 'string' ? input.textPrompt : keys.map(key => `${key}:\n${parts[key]}`).join('\n\n');
  if (input.packedPrompt !== undefined) {
    if (input.type === '文生' || typeof input.packedPrompt !== 'string' || !input.packedPrompt.trim()) invalid('输入.packedPrompt', '仅素材模式可使用非空已保存编排正文');
    const packedParts = parseSections(input.packedPrompt, keys);
    if (keys.some(key => packedParts[key] !== parts[key].trim())) invalid('输入.packedPrompt', '已保存编排中的三段正文与当前已审核文本不一致，请重新编排；不能改写对白或时间线');
    body = input.packedPrompt;
  } else if (input.type === '首尾帧') {
    body = '首帧为上一镜的尾帧，用作本镜0秒的开场画面。后续动作、运镜与声音按下文已审核分镜执行，不将首帧误作本镜目标尾帧。\n\n' + body;
  }
  if (input.referenceBindings !== undefined) {
    if (input.type !== '多模态' || input.packedPrompt !== undefined || !Array.isArray(input.referenceBindings) || input.referenceBindings.length !== input.referenceImages?.length)
      invalid('输入.referenceBindings', '需按多模态参考图顺序一图一项，已保存编排不重复添加映射');
    const rows = input.referenceBindings.map((row, index) => {
      if (row?.kind === 'scene') {
        if (typeof row.name !== 'string' || !row.name.trim() || typeof row.description !== 'string' || typeof row.state !== 'string') invalid('输入.referenceBindings','场景参考需含名称、固定设定与镜头状态');
        return `<Subject ${index + 1}> 是第${index + 1}张参考图中的场景${JSON.stringify(row.name)}。保留空间布局、固定地标、材质与色彩：${row.description}。本镜状态：${row.state || '沿用基础状态'}。只按状态改变光照、天气或剧情已有变化，机位变化不改变固定空间；不复制图中人物，不把参考图强制作为首尾帧。`;
      }
      if (!row || ['name', 'speaker_tag', 'costume'].some(key => typeof row[key] !== 'string') || !row.name.trim()) invalid('输入.referenceBindings', '需包含人物姓名、说话人标记和服装说明');
      return `第${index + 1}张参考图：${JSON.stringify(row.name)}${row.speaker_tag ? `，说话人标记${row.speaker_tag}` : ''}，服装：${JSON.stringify(row.costume || '以本镜既定着装为准')}。`;
    });
    body = `参考图对应关系（按images数组顺序，从1开始）：\n${rows.join('\n')}\n人物图片只约束对应人物身份、面相、体型和本镜服装；场景图片只约束对应空间，不能把定妆照背景带入场景。不交换身份，不增加出镜人物；参考图不是本镜首帧或尾帧。\n\n${body}`;
  }
  if (action === 'regenerate') {
    if (typeof input.opinion !== 'string' || !input.opinion.trim()) invalid('输入.opinion', '修订意见不能为空');
    body += `\n\nRevision instructions:\n${input.opinion}`;
  }
  const request = { mode: modes[input.type], duration: input.duration, aspectRatio: input.aspectRatio, prompt: body,
    ...(input.firstFrame !== undefined ? { inputReference: input.firstFrame } : {}),
    ...(input.lastFrame !== undefined ? { lastFrame: input.lastFrame } : {}),
    ...(input.referenceImages !== undefined ? { referenceImages: [...input.referenceImages] } : {}) };
  try { videoPayload({ model: 'MiniMax-H3', ...request }); }
  catch (error) { invalid('视频请求', error.message); }
  return request;
}
