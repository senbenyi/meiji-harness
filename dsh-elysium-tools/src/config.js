import { isAbsolute } from 'node:path'

export function requiredConfig(name, kind = 'path') {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`缺少或无效配置：${name}`)
  if (kind === 'path' && !isAbsolute(value)) throw new Error(`${name} 必须为绝对路径`)
  if (kind === 'url') {
    if (/\s/.test(value)) throw new Error(`${name} 地址不能包含空白字符`)
    let url
    try { url = new URL(value) } catch { throw new Error(`${name} 必须为 HTTP(S) 地址`) }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.port === '0' || url.username || url.password || url.search || url.hash) throw new Error(`${name} 必须为不含凭据、查询参数的 HTTP(S) 地址`)
    return value.replace(/\/+$/, '')
  }
  return value
}
