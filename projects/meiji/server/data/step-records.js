import { publicData } from '../gateway/redact.js';

// 步骤记录只保存实际发出的消息与业务参数；HTTP 往来单独存入 step.http。
// 业务参数里的参考图等 base64 内容与 HTTP 记录一样脱敏，避免记录膨胀。
export function redactInput(input) {
  if (input === undefined) return undefined;
  const json = publicData(input);
  return json === undefined ? undefined : JSON.parse(json);
}

export function stepPrompt({ node, action, model, input, messages, body, parameters }) {
  return {
    node, action, model,
    input: redactInput(input),
    messages: messages || (body != null ? [{ role: 'user', content: body }] : []),
    ...(parameters ? { parameters } : {}),
  };
}

// 旧格式（prompt 内含 system/user/body/transfers）拆为精简 prompt 与 http。
export function splitLegacyPrompt(prompt) {
  if (!prompt || typeof prompt !== 'object' || !Object.keys(prompt).length) return { prompt: null, http: [] };
  const { transfers = [], system, user, body, messages, ...rest } = prompt;
  // 只有原记录确有提示词正文时才整理为 messages；其他历史字段原样保留。
  const hasText = messages !== undefined || system != null || user != null || body != null;
  const list = messages || [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...(user != null || body != null ? [{ role: 'user', content: user ?? body }] : []),
  ];
  return {
    prompt: { ...rest, ...(Object.hasOwn(rest, 'input') ? { input: redactInput(rest.input) } : {}), ...(hasText ? { messages: list } : {}) },
    http: Array.isArray(transfers) ? transfers : [],
  };
}
