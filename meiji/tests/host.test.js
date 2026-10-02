import test from 'node:test'
import assert from 'node:assert/strict'
import { hostWorkspaces, setWorkspaceRegistry } from '../server/host/harness-workspaces.js'
import { insertSessionLog, setHostLogger } from '../server/host/session-log.js'
import { fakeRegistry } from './fixtures/host.js'

// 契约：Harness 公开的 workspaceRegistry 提供 list()/get(id)（含 sessionIds）与 archivedSessionIds。
const rows = {
  w1: { title: ' 短剧 A ', path: '/a', sessionIds: ['session-1', 'session-2', 'session-3'] },
  w2: { title: '', path: '/b', sessionIds: ['session-9'] },
}

test('workspace lookup uses the public registry only', () => {
  const workspaces = hostWorkspaces(fakeRegistry(rows, ['session-1']))
  assert.deepEqual(workspaces.forSession('session-2'), { id: 'w1', title: '短剧 A' })
  assert.deepEqual(workspaces.forSession('session-9'), { id: 'w2', title: 'w2' })
  assert.equal(workspaces.forSession('session-x'), null)
  assert.deepEqual(workspaces.activeSessions('w1'), ['session-2', 'session-3'])
  assert.deepEqual(workspaces.activeSessions('missing'), [])
})

test('an unavailable registry is an explicit 503, not an empty result', () => {
  setWorkspaceRegistry(null)
  assert.throws(() => hostWorkspaces().forSession('session-1'), error => error.status === 503)
  setWorkspaceRegistry(fakeRegistry(rows))
  try { assert.equal(hostWorkspaces().forSession('session-9').id, 'w2') }
  finally { setWorkspaceRegistry(null) }
})

test('a failing session append is reported once and never throws', () => {
  const warnings = []
  setHostLogger({ warn: (format, message) => warnings.push(message) })
  try {
    const broken = { append() { throw new Error('closed') } }
    assert.equal(insertSessionLog(broken, '第一条'), false)
    assert.equal(insertSessionLog(broken, '第二条'), false)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /closed/)
    const events = []
    assert.equal(insertSessionLog({ append: (type, data) => events.push({ type, data }) }, '正常'), true)
    assert.deepEqual(events.map(event => event.type), ['command/run', 'command/done'])
  } finally { setHostLogger(null) }
})
