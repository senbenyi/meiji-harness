import { readable } from './readable.js'

/** 仅展示本次记录的结果，不读取当前项目补造历史。 */
export function renderRecordedRows(body, rows, title, { node }) {
  if (!Array.isArray(rows)) return false
  body.append(node('h4', title))
  rows.forEach((row, index) => {
    const content = node('pre', readable(row))
    // 大纲也会作为场景、团队、人物等节点的输入；各入口统一取消故事段内滚动。
    if (typeof row.body === 'string') {
      content.style.maxHeight = 'none'
      content.style.overflow = 'visible'
    }
    body.append(node('h4', row.title || row.name || `${title} ${index + 1}`), content)
  })
  return true
}
