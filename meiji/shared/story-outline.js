// 大纲只保存编号故事小段；同一小段可包含多行正文和对白。
export const outlineFields = Object.freeze(['故事小段'])

export function outlineFailures(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['大纲必须为仅含「故事小段」的 JSON 对象']
  const failures = []
  for (const field of outlineFields) {
    if (typeof value[field] !== 'string' || !value[field].trim()) failures.push(`大纲字段「${field}」必须为非空字符串`)
    else if (value[field].trim().startsWith(`【${field}】`)) failures.push(`大纲字段「${field}」只写正文，不重复小节标题`)
  }
  for (const field of Object.keys(value)) if (!outlineFields.includes(field)) failures.push(`大纲不允许额外字段「${field}」`)
  if (typeof value.故事小段 === 'string' && value.故事小段.trim()) {
    const text = value.故事小段.trim(), markers = [...text.matchAll(/^(\d+)[.、．]\s*/gm)]
    if (!markers.length || markers[0].index !== 0 || markers.some((marker, index) => Number(marker[1]) !== index + 1)) failures.push('故事小段须从 1 开始按 1、2、3… 连续编号，每段编号独占行首')
    else if (markers.some((marker, index) => !text.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? text.length).trim())) failures.push('故事小段不能有空白段落')
  }
  return failures
}

export function normalizeOutline(value, status = 502) {
  const failures = outlineFailures(value)
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { status })
  return Object.fromEntries(outlineFields.map(field => [field, value[field].trim()]))
}

export function outlineText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return typeof value.故事小段 === 'string' ? value.故事小段 : ''
}
