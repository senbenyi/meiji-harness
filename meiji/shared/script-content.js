import { summaryLength } from './episode-summary.js'

export const MAX_SCRIPT_BYTES = 1024 * 1024
export const MAX_SCRIPT_CHARACTERS = 200000
export function scriptText(bytes) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim() }
  catch { throw Object.assign(new Error('剧本须为 UTF-8 编码的 TXT/TEXT 文本'), { status: 400 }) }
  if (!text || text.includes('\0') || text.length > MAX_SCRIPT_CHARACTERS) throw Object.assign(new Error('剧本正文需为 1–200000 字符的文本'), { status: 400 })
  return text
}
export function projectSummaryFailures(value) {
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.summary !== 'string' || !summaryLength(value.summary)) return ['项目摘要须为仅含非空 summary 字符串的 JSON 对象']
  return summaryLength(value.summary) > 500 ? ['项目摘要不能超过 500 个非空白 Unicode 字符（标点计入）'] : []
}
