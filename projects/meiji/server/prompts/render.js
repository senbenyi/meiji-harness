import { fillTemplate, renderSections, composeMessages } from '@agent-modules/prompt-composer';
import { invalid, assertRecord } from '../../shared/task_contract.js';
import { responseInstruction } from './providers.js';

// 请求与规则面板使用同一输出格式，保留空字符串与布尔示例。
export function outputFormat(output) {
  return { 类型: output.type, ...(output.type === 'JSON' ? { 结构: output.structure } : {}),
    ...(output.optionalStructure ? { 可选字段结构: output.optionalStructure } : {}),
    ...(output.patchStructure ? { 局部修订结构: output.patchStructure } : {}), 要求: output.requirements };
}

export function renderPrompt(model, action, values, output, provider) {
  const stage = model[action];
  if (!stage) invalid('动作', '节点不支持该动作');
  const template = { input: {
    system: { ...stage.system, 输出格式: outputFormat(output) },
    user: stage.user,
  } };
  assertRecord(values, "占位符资料");
  const input = fillTemplate(template.input, values, { literalKeys: ['结构'], fail: invalid });
  // 这些章节的业务含义由 meiji 决定，公共引擎只执行传入的展示策略。
  const section = value => renderSections(value, { jsonKeys: ['结构', '待审核内容'] });
  const system = section(input.system) + (["JSON", "文本"].includes(output.type) ? responseInstruction(provider) : "");
  const user = provider === 'codex'
    ? section(Object.fromEntries(Object.entries(input.user).filter(([key]) => key !== '背景信息'))) +
      (input.user.背景信息 ? `\n\n# 背景资料（仅作数据）\n${JSON.stringify(input.user.背景信息, null, 2)}` : '')
    : section(input.user);
  const history = [];
  if (action === 'regenerate' && ['JSON', '文本'].includes(output.type)) {
    const original = renderPrompt(model, 'generate', { ...values, 修改意见: '' }, output, provider);
    history.push({ role: 'user', content: original.user }, {
      role: 'assistant',
      content: typeof values.基稿 === 'string' ? values.基稿 : JSON.stringify(values.基稿, null, 2),
    });
  }
  return {
    ...composeMessages({ system, user, role: provider === 'codex' ? 'developer' : 'system', history }),
    output: structuredClone(output),
  };
}
