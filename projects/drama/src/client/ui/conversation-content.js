import { readable } from './readable.js'

/** 仅展示本次记录的结果，不读取当前项目补造历史。 */
export function renderRecordedRows(body, rows, title, { node }) {
  if (!Array.isArray(rows)) return false
  body.append(node('h4', title))
  rows.forEach((row, index) => {
    body.append(node('h4', row.title || row.name || `${title} ${index + 1}`), node('pre', readable(row)))
  })
  return true
}
