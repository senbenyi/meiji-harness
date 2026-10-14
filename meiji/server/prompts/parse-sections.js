import { invalid } from '../../shared/task_contract.js';

export function parseSections(raw, keys) {
  const pattern = new RegExp(`^(?:#{1,6}[ \\t]*)?(${keys.join('|')})[ \\t]*[:：]?[ \\t]*`, 'gm');
  const matches = [...raw.matchAll(pattern)];
  if (matches.length !== keys.length || matches.some((match, index) => match[1] !== keys[index]))
    invalid('文生视频提示词', '需依次包含规定的三个段落标题');
  const sections = Object.fromEntries(matches.map((match, index) => [match[1], raw.slice(match.index + match[0].length, matches[index + 1]?.index ?? raw.length).trim()]));
  if (Object.values(sections).some(value => !value)) invalid('文生视频提示词', '三个段落内容均不能为空');
  return sections;
}
