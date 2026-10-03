// 仅处理内容文本化和消息序列化；业务资料、规则与编排由各 model 决定。
import { render } from './skill-prompts.js'

export const contentText = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
// 只包装输入资料；已结构化的结果保留字段，正文原文由 JSON 序列化转义。
export function contentData(value, field = 'content') {
  if (value == null || typeof value === 'string' && !value.trim()) return ''
  if (Array.isArray(value)) return { [field]: value }
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return { [field]: parsed }
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
  }
  return { [field]: value }
}
export const messages = ({ system, user }) => [
  { role: 'system', content: render(system) },
  { role: 'user', content: render(user) },
]
