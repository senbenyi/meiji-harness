export { RulesModel } from './rules-model.js';

function invalid(path, message) {
  throw Object.assign(new Error(`${path}：${message}`), { code: 'INVALID_TEMPLATE', path });
}

// 只展开模板原文；完整占位符可携带对象，注入数据不再解释为模板。
export function fillTemplate(template, values, { literalKeys = [], fail = invalid } = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail('占位符资料', '需为对象');
  const fill = value => {
    if (typeof value === 'string') {
      const exact = /^\{\{([^{}]+)\}\}$/.exec(value);
      if (exact) {
        if (!Object.hasOwn(values, exact[1])) fail('占位符', `缺少 ${exact[1]}`);
        return structuredClone(values[exact[1]]);
      }
      return value.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
        if (!Object.hasOwn(values, key)) fail('占位符', `缺少 ${key}`);
        if (typeof values[key] === 'object') fail('占位符', `${key} 的嵌入位置只能为文本`);
        return String(values[key]);
      });
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, literalKeys.includes(key) ? structuredClone(item) : fill(item)])
      .filter(([, item]) => item !== '' && item !== null));
    return value;
  };
  return fill(template);
}

export function renderSections(value, { jsonKeys = [], level = 1 } = {}) {
  return Object.entries(value).map(([key, item]) => {
    if (item === null || item === '' || (Array.isArray(item) && !item.length)) return '';
    if (typeof item === 'object' && !Array.isArray(item) && !jsonKeys.includes(key)) {
      const body = renderSections(item, { jsonKeys, level: level + 1 });
      return body ? `${'#'.repeat(level)} ${key}\n${body}` : '';
    }
    return `${'#'.repeat(level)} ${key}\n${typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)}`;
  }).filter(Boolean).join('\n\n');
}

// 规则、输出说明、历史与角色都由调用方提供，不添加隐含规则。
export function composeMessages({ system, user, role = 'system', history = [] }) {
  const messages = [{ role, content: system }, ...structuredClone(history), { role: 'user', content: user }];
  return { messages, system, user, body: messages.map(message => message.content).join('\n\n') };
}
