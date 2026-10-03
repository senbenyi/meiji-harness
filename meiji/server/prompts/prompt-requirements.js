// 将代码确定的要求写成明确的自然语言；不让模型推断默认值。
const fields = {
  durationSeconds: ['时长', '秒'], minDurationSeconds: ['总时长下限', '秒'], maxDurationSeconds: ['总时长上限', '秒'],
  minShotDurationSeconds: ['单镜时长下限', '秒'], maxShotDurationSeconds: ['单镜时长上限', '秒'],
  style: ['项目风格', ''], shotId: ['目标镜头', ''], mode: ['视频生成模式', ''],
  startMs: ['开始时间', '毫秒'], endMs: ['结束时间', '毫秒'],
}
export function requirementsText(parameters = {}, language = '', extra = '') {
  const lines = [language]
  if (parameters.width && parameters.height) lines.push(`画幅：${parameters.width} × ${parameters.height} 像素${parameters.orientation ? `，${parameters.orientation}` : ''}`)
  for (const [key, value] of Object.entries(parameters)) {
    if (['width', 'height', 'orientation'].includes(key) || value == null || value === '') continue
    const [label, unit] = fields[key] || [key, '']
    lines.push(`${label}：${value}${unit ? ` ${unit}` : ''}`)
  }
  lines.push(extra)
  return lines.filter(Boolean).join('\n')
}
