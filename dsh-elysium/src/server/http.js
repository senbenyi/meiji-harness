// 职责：提供插件 HTTP 路由共用的同源凭据校验、JSON 响应和限量请求解析。
import { timingSafeEqual } from 'node:crypto'
import { statusError } from '../utils/errors.js'

export const invalidRequest = message => statusError(400, message)

export function authenticated(url, token) {
  const supplied = Buffer.from(url.searchParams.get('t') || ''), expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}

export async function readJsonBody(req, limit = 2 * 1024 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > limit) throw Object.assign(new Error('项目数据过大'), { status: 413 })
    chunks.push(Buffer.from(chunk))
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidRequest('JSON 对象无效')
    return value
  } catch (error) {
    if (error.status) throw error
    throw invalidRequest('JSON 对象无效')
  }
}
