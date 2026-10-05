// Harness 会话日志的唯一接入点。
// 日志写成已登记的 command/run + command/done 事件（只在界面显示，不进入模型上下文）。
// 回合生命周期由 Harness 管理；纯日志会话保持空白，不能为显示日志伪造回合。
// 写入失败不影响任务执行，但会通过 Harness logger 记录（同一原因只记一次），不再静默。
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

let logger = null
const warned = new Set()
export function setHostLogger(value) { logger = value || null }
function warnOnce(message) {
  if (!logger || warned.has(message)) return
  warned.add(message)
  logger.warn('Meiji session log failed: %s', message)
}

const current = new AsyncLocalStorage()
const purpose = new AsyncLocalStorage()
export const runWithLogPurpose = (name, fn) => purpose.run(name, fn)
export const logPurpose = () => purpose.getStore()

export function runWithSessionLog(session, fn) {
  return current.run(session, fn)
}

export function sessionForLog() {
  return current.getStore()
}

export function insertSessionLog(session, text, failed = false, title = '日志') {
  const body = String(text || '').trim()
  if (!session?.append || !body) return
  const card = body.includes('\n') ? body : `${body}\n`
  const commandId = randomUUID()
  try {
    appendCommand(session, commandId, title, card, failed)
    return true
  } catch (error) {
    warnOnce(`写入命令日志失败：${error.message}`)
    return false
  }
}

function appendCommand(session, commandId, title, card, failed) {
  session.append('command/run', {
    commandId,
    name: title,
    args: title,
    source: { kind: 'user' },
  })
  session.append('command/done', {
    commandId,
    kind: failed ? 'error' : 'success',
    text: card,
  })
}
