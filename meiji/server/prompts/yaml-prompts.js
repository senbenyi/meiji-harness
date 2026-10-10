import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { invalid, assertRecord } from "../../shared/task-contract.js";
const root = new URL("../../dev_docs/in_puts/", import.meta.url);
export async function loadTemplate(name) {
  if (typeof name !== "string" || !/^[a-z]+(?:-[a-z]+)*$/.test(name))
    invalid("模板", "名称无效");
  const document = parseDocument(
    await readFile(new URL(`${name}.yaml`, root), "utf8"),
    { uniqueKeys: true },
  );
  if (document.errors.length) invalid("模板", document.errors[0].message);
  const value = document.toJS({ maxAliasCount: 0 });
  validateTemplate(value);
  return value;
}
export function validateTemplate(template) {
  assertRecord(template, "模板");
  if (Object.keys(template).some((k) => !["mark", "input"].includes(k)))
    invalid("模板", "只允许 mark 和 input");
  assertRecord(template.input, "input");
  for (const k of ["system", "user"])
    assertRecord(template.input[k], `input.${k}`);
  if (Object.keys(template.input).some((k) => !["system", "user"].includes(k)))
    invalid("input", "只允许 system/user");
  const checkOutputLocation = (value, path) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      const location = `${path}.${key}`;
      if (key === "输出格式" && location !== "input.system.输出格式")
        invalid(location, "输出格式只允许在 input.system 中定义");
      checkOutputLocation(nested, location);
    }
  };
  checkOutputLocation(template.input, "input");
  const output = template.input.system.输出格式;
  assertRecord(output, "input.system.输出格式");
  if (!["JSON", "文本", "图片", "视频"].includes(output.类型))
    invalid("输出格式.类型", "未知返回类型");
  if (output.类型 === "JSON") assertRecord(output.结构, "输出格式.结构");
  else if (Object.hasOwn(output, "结构"))
    invalid("输出格式.结构", "媒体不定义 JSON 结构");
  if (
    typeof template.input.user.任务 !== "string" ||
    !template.input.user.任务.trim() ||
    template.input.user.任务.includes("{{")
  )
    invalid("input.user.任务", "任务必须为模板固定正文");
  return template;
}
export function renderTemplate(template, values) {
  validateTemplate(template);
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
  const input = fill(template.input),
    output = input.system.输出格式;
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
  return {
    system: section(input.system),
    user: section(input.user),
    body: [section(input.system), section(input.user)].join("\n\n"),
    output: {
      type: output.类型,
      ...(output.类型 === "JSON" ? { structure: output.结构 } : {}),
      requirements: output.要求 || "",
    },
  };
}
export function ruleInputs(rules, business, targetId) {
  const applicable = rules.filter(
    (r) =>
      r.适用业务.includes(business) &&
      (r.范围 === "project" || r.节点id === targetId),
  );
  const ordered = [
    ...applicable.filter((r) => r.范围 === "project"),
    ...applicable.filter((r) => r.范围 === "node"),
  ];
  const must = ordered
    .filter((r) => r.约束 === "必须")
    .map((r) => r.内容)
    .filter(Boolean);
  const groups = new Map();
  for (const r of ordered.filter((r) => r.约束 === "参考" && r.内容)) {
    if (!groups.has(r.类别)) groups.set(r.类别, []);
    groups.get(r.类别).push(r.内容);
  }
  return {
    补充规则: must.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    指导素材: [...groups]
      .map(([k, v]) => `${k}：\n${v.join("\n")}`)
      .join("\n\n"),
    指导素材规则: groups.size
      ? "参考素材仅作参考，不得违反本次修改意见、节点规则、项目规则及基础规则。"
      : "",
  };
}
