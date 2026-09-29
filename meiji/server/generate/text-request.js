import { askModel } from './chat.js'
import { runWithLogPurpose } from '../host/session-log.js'
import { markApiFailure } from '../data/operation-context.js'

// 一个节点只发送一次完整请求；不加载 Skill、不拼接提示词、不触发其他节点。
export async function runTextRequest(message, { request, logPurpose, logStage, ...options } = {}) {
  options.signal?.throwIfAborted()
  try {
    return await runWithLogPurpose(`${logPurpose || message.skill}${logStage ? '·' + logStage : ''}`, () => request
      ? request({ ...options, ...message })
      : askModel({ ...options, system: message.system, prompt: message.user, json: message.json }))
  } catch (error) { throw markApiFailure(error) }
}
