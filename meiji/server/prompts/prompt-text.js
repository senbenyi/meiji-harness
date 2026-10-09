// 仅处理内容文本化和消息序列化；业务资料、规则与编排由各 model 决定。
import { render } from './skill-prompts.js'

export const contentText = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
// 已生成的 JSON 保留原结构；单段正文直接取内容，列表保留具名集合。
export function contentData(value, field = 'content') {
  if (value == null || typeof value === 'string' && !value.trim()) return ''
  if (Array.isArray(value)) return field === 'outline' ? value : { [field]: value }
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return field === 'outline' ? parsed : { [field]: parsed }
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
  }
  return value
}
export const messages = ({ system, user }) => [
  { role: 'system', content: render(system) },
  { role: 'user', content: render(user) },
]
