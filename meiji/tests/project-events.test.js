import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { subscribeProject } from '../server/data/project-events.js'

test('project notification follows a committed revision and subscriptions can disconnect', async t => {
 const e = await setupModel(t), events = []
 const unsubscribe = subscribeProject(e.home, e.id, event => events.push(event))
 const saved = await e.store.save(e.id, { title: '已保存' })
 assert.deepEqual(events, [{ projectId: e.id, revision: saved.revision }])
 assert.equal((await e.store.read(e.id)).revision, events[0].revision)
 unsubscribe()
 await e.store.save(e.id, { title: '之后' })
 assert.equal(events.length, 1)
})
