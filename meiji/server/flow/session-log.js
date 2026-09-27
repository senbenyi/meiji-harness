import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

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
