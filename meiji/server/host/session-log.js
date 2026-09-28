// Harness 会话日志的唯一接入点。
// 日志写成已登记的 command/run + command/done 事件（只在界面显示，不进入模型上下文）。
// 仅含日志的新会话会被 Harness 视为空白而隐藏，因此首次写入前补一个空的 turn/start + turn/end。
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

function revealBlankSession(session) {
  if (typeof session.snapshotEvents !== 'function') return
  let events
  try { events = session.snapshotEvents() } catch (error) { warnOnce(`读取会话事件失败：${error.message}`); return }
  if (events.some(event => event.type === 'turn/start')) return
  try {
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  } catch (error) {
    // 无法补齐空回合时仍继续写日志。
    warnOnce(`补齐空回合失败：${error.message}`)
  }
}

export function insertSessionLog(session, text, failed = false, title = '日志') {
  const body = String(text || '').trim()
  if (!session?.append || !body) return
  revealBlankSession(session)
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
