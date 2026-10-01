// 仅处理内容文本化和消息序列化；业务资料、规则与编排由各 model 决定。
import { render } from './skill-prompts.js'

export const contentText = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
export const messages = ({ system, user }) => [
  { role: 'system', content: render(system) },
  { role: 'user', content: render(user) },
]
