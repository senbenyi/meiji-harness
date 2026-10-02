export function outputLanguage(value = 'zh-CN') {
  if (!['zh-CN', 'en'].includes(value)) throw Object.assign(new Error('生成语言仅支持中文或英文'), { status: 400 })
  return value
}
