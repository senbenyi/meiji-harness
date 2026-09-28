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

function revealBlankSession(session) {
  if (typeof session.snapshotEvents !== 'function') return
  let events
  try { events = session.snapshotEvents() } catch { return }
  if (events.some(event => event.type === 'turn/start')) return
  try {
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  } catch {
    // A session that cannot open a turn still keeps the command log.
  }
}

export function insertSessionLog(session, text, failed = false, title = '日志') {
  const body = String(text || '').trim()
  if (!session?.append || !body) return
  revealBlankSession(session)
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
