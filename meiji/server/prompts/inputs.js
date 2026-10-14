export function ruleInputs(rules) {
  const must = rules
    .filter((r) => r.constraint === "必须")
    .map((r) => r.content)
    .filter(Boolean);
  const groups = new Map();
  for (const r of rules.filter((r) => r.constraint === "参考" && r.content)) {
    if (!groups.has(r.category || "参考")) groups.set(r.category || "参考", []);
    groups.get(r.category || "参考").push(r.content);
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
// 提示词中的输出语言用自然语言名称，不直接写语言代码。
export function languageName(code) {
  return { "zh-CN": "简体中文", en: "English（英文）" }[code] || code;
}

export function commonValues(input) {
  return {
    ...ruleInputs(input.rules),
    输出语言: languageName(input.language),
    补充需求: input.requirements,
    修改意见: input.opinion || '',
    基稿: input.content,
    待审核内容: input.content,
    待修订镜头表: input.content,
    上一版切分: input.content,
  };
}
