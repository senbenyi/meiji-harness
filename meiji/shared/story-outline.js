// 大纲的数据结构；【标题】只在界面展示时生成。
export const outlineFields = Object.freeze(['主角动机', '世界规则', '因果剧情', '情绪线索', '对白节拍', '结尾状态', '结尾关键画面'])

export function outlineFailures(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['大纲必须为七个中文字段的 JSON 对象']
  const failures = []
  for (const field of outlineFields) {
    if (typeof value[field] !== 'string' || !value[field].trim()) failures.push(`大纲字段「${field}」必须为非空字符串`)
    else if (value[field].trim().startsWith(`【${field}】`)) failures.push(`大纲字段「${field}」只写正文，不重复小节标题`)
  }
  for (const field of Object.keys(value)) if (!outlineFields.includes(field)) failures.push(`大纲不允许额外字段「${field}」`)
  return failures
}

export function normalizeOutline(value, status = 502) {
  const failures = outlineFailures(value)
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { status })
  return Object.fromEntries(outlineFields.map(field => [field, value[field].trim()]))
}

export function outlineText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return outlineFields.map(field => `【${field}】\n${value[field] || ''}`).join('\n\n')
}
