import { resolve } from 'node:path'
const listeners = new Map()
const key = (home, id) => resolve(home) + ':' + id
export function subscribeProject(home, id, listener) {
  const idKey = key(home, id)
  if (!listeners.has(idKey)) listeners.set(idKey, new Set())
  const entries = listeners.get(idKey)
  entries.add(listener)
  return () => { entries.delete(listener); if (!entries.size) listeners.delete(idKey) }
}
export function notifyProject(home, id, revision) {
  for (const listener of listeners.get(key(home, id)) || []) {
    try { listener({ projectId: id, revision }) } catch { /* A disconnected viewer cannot fail a committed write. */ }
  }
}
