// 提示词中的输出语言用自然语言名称，不直接写语言代码。
export function languageName(code) {
  return { "zh-CN": "简体中文", en: "English（英文）" }[code] || code;
}

export function commonValues(input) {
  return {
    输出语言: languageName(input.language),
    补充需求: input.requirements,
    修改意见: input.opinion || '',
    基稿: input.content,
    待审核内容: input.content,
    待修订镜头表: input.content,
    上一版切分: input.content,
  };
}
