import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { setupModel } from './fixtures/model.js'
import { createBridge } from '../client/chat-bridge.js'

test('项目删除响应把新会话交给导航，失败或删除剧集不切会话', async t => {
  const e = await setupModel(t), project = await e.store.read(e.id)
  const dom = new JSDOM('', { url: 'http://localhost' }), previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  const sessionId = 'session-11111111-1111-4111-8111-111111111111'
  dom.window.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  const next = { completed: true, deleted: true, workspace: null, sessionId: 'session-22222222-2222-4222-8222-222222222222' }
  const navigations = [], shown = []
  let result = next, fail = false
  const bridge = createBridge({ request: async () => { if (fail) throw new Error('失败'); return result }, jsonBody: body => ({ body: JSON.stringify(body) }),
    onDeleted: place => navigations.push(place), showProject: project => shown.push(project), status() {} })
  await bridge.perform(project, 'project-delete', { confirmDelete: true })
  assert.deepEqual(navigations, [next])
  result = { completed: true, project: { id: 'p' } }
  await bridge.perform(project, 'episode-delete', { episodeId: e.episodeId, confirmDelete: true })
  assert.deepEqual(shown, [{ id: 'p' }]); assert.equal(navigations.length, 1)
  result = { completed: true, deleted: true }
  await bridge.perform(project, 'project-delete', { confirmDelete: true })
  assert.equal(navigations.at(-1).sessionId, undefined)
  assert.equal(navigations.length, 2)
  fail = true
  await assert.rejects(bridge.perform(project, 'project-delete', { confirmDelete: true }), /失败/)
  assert.equal(navigations.length, 2)
})
