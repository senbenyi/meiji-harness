const purposes = { conversation: '会话回复', 'session-title': '会话标题生成', compaction: '会话上下文压缩' };
const short = value => {
  const text = value.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(text);
  return characters.length > 30 ? characters.slice(0, 29).join('') + '…' : text;
};
const textOf = content => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : '';
const userText = content => {
  const text = textOf(content).replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/giu, '').trim();
  // 某些适配器把运行环境和技能提醒也放进user消息，它们不代表用户业务意图。
  return text.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.') ? '' : text;
};
const objectOf = value => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};
const nameOf = value => {
  const object = objectOf(value);
  if (!object || typeof object !== 'object' || Array.isArray(object)) return '';
  for (const key of ['project_name', 'node_name', 'name', 'title'])
    if (typeof object[key] === 'string' && object[key].trim()) return object[key].trim();
  return '';
};

/** 只从用户文本与明确的结构化名称取标题，不读取推理、图片或普通回答。 */
export function recordTitle({ title, method, path, params = {}, response }) {
  if (typeof title === 'string' && title.trim()) return title.trim();
  if (method === 'MODEL') {
    const purpose = typeof params?.purpose === 'string' && params.purpose.trim()
      ? params.purpose.trim() : path?.split('/').at(-1) || 'conversation';
    if (purpose !== 'conversation') return Object.hasOwn(purposes, purpose) ? purposes[purpose] : purpose;
    const message = Array.isArray(params?.messages) ? params.messages.findLast(message => message?.role === 'user' && userText(message.content)) : null;
    const input = userText(message?.content).replace(/^(?:(?:请你|请|麻烦你|麻烦|帮我|帮助我)[，,\s]*)+/u, '');
    const summary = input.split(/[\n。！？!?]/u).find(part => part.trim())?.trim() || '';
    const content = Array.isArray(response?.content) ? response.content : [];
    let name = '';
    for (const block of content) {
      if (block?.type === 'tool-call') name = nameOf(block.arguments);
      else if (block?.type === 'text') name = nameOf(block.text);
      if (name) break;
    }
    // 完整摘要已含名称时不重复；优先保留名称，给前面的业务意图留下空间。
    if (name && !summary.includes(name)) {
      const suffix = short(name), room = Math.max(0, 29 - Array.from(suffix).length);
      return short(summary && room ? `${Array.from(summary).slice(0, room).join('')}：${suffix}` : suffix);
    }
    return short(summary || name || purposes.conversation);
  }
  return `${method} ${path}`;
}
