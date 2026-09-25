import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

const current = new AsyncLocalStorage()

export function runWithSessionLog(session, fn) {
  return current.run(session, fn)
}

export function sessionForLog() {
  return current.getStore()
}

export function insertSessionLog(session, text, failed = false) {
  const body = String(text || '').trim()
  if (!session?.append || !body) return
  const card = body.includes('\n') ? body : `${body}\n`
  const commandId = randomUUID()
  session.append('command/run', {
    commandId,
    name: '日志',
    args: '日志',
    source: { kind: 'user' },
  })
  session.append('command/done', {
    commandId,
    kind: failed ? 'error' : 'success',
    text: card,
  })
}
