import { invalid, assertRecord } from '../../shared/task_contract.js';
import { responseInstruction } from './providers.js';

export function renderPrompt(model, action, values, output, provider) {
  const stage = model[action];
  if (!stage) invalid('动作', '节点不支持该动作');
  const template = { input: {
    system: { 角色: stage.role || model.role, ...stage.system, 输出格式: { 类型: output.type, ...(output.type === "JSON" ? { 结构: output.structure } : {}), 要求: output.requirements } },
    user: stage.user,
  } };
  assertRecord(values, "占位符资料");
  // 只处理模板原文；注入资料中的 {{...}} 不再二次解释。
  const fill = (v) => {
    if (typeof v === "string") {
      const exact = /^\{\{([^{}]+)\}\}$/.exec(v);
      if (exact) {
        if (!Object.hasOwn(values, exact[1]))
          invalid("占位符", `缺少 ${exact[1]}`);
        return structuredClone(values[exact[1]]);
      }
      return v.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
        if (!Object.hasOwn(values, key)) invalid("占位符", `缺少 ${key}`);
        if (typeof values[key] === "object")
          invalid("占位符", `${key} 的嵌入位置只能为文本`);
        return String(values[key]);
      });
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .map(([k, x]) => [k, k === "结构" ? structuredClone(x) : fill(x)])
          .filter(([, x]) => x !== "" && x !== null),
      );
    return v;
  };
  const input = fill(template.input);
  const section = (value, level = 1) =>
    Object.entries(value)
      .map(([key, v]) => {
        if (v === null || v === "" || (Array.isArray(v) && !v.length))
          return "";
        if (typeof v === "object" && !Array.isArray(v) && key !== "结构") {
          const body = section(v, level + 1);
          return body ? `${"#".repeat(level)} ${key}\n${body}` : "";
        }
        return `${"#".repeat(level)} ${key}\n${typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)}`;
      })
      .filter(Boolean)
      .join("\n\n");
  const system = section(input.system) + (["JSON", "文本"].includes(output.type) ? responseInstruction(provider) : "");
  const user = section(input.user);
  return {
    system,
    user,
    body: [system, user].join("\n\n"),
    output: structuredClone(output),
  };
}
