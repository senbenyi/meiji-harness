import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { setupModel } from './fixtures/model.js'
import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass } from './fixtures/review-result.js'
import { executeTask } from '../server/flow/shared/task-executor.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { registerPanel } from '../server/http/panel-routes.js'
import { linkStore } from '../server/data/workspace-links.js'
import { saveImageDraft } from '../server/data/image-storage.js'

test('面板接口读取三层历史、精确提示词和直接图片操作结果', async t => {
  const e = await setupModel(t), sessionId = 'session-11111111-1111-4111-8111-111111111111', previous = process.env.DSH_HOME
  process.env.DSH_HOME = e.home; t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const manager = createOperationManager({ home: e.home, execute: (op, deps) => executeTask(op, { ...deps, request: async message => message.skill === 'review' ? reviewPass : secondsForRequest(message) }) }); let handler
  const panelGoals = { begin: async () => ({ ref: { id: 'goal-api', revision: 1 }, finish() {}, discard() {} }) }
  registerPanel({ connection: { requestRejection: () => null }, logger: { warn() {} }, sessionController: { resolveAgent: async () => ({ agent: { id: sessionId } }) }, sessions: new Map(), effect: fn => fn(), on() {}, webServer: { register: value => { handler = value.handler } } }, Promise.resolve(), manager, undefined, panelGoals)
  const query = new URLSearchParams({ projectId: e.id, episodeId: e.episodeId, sessionId })
  async function call(path, body) {
    const req = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(req, { method: body ? 'POST' : 'GET', url: `/plugins/meiji/${path}?${query}`, headers: { 'x-meiji-request': '1' } })
    let code, value
    await handler(req, { writeHead: status => { code = status }, end: text => { value = JSON.parse(text) } })
    return { code, value }
  }
  const admitted = await call('turn', { action: 'seconds', projectId: e.id, episodeId: e.episodeId, sessionId })
  assert.equal(admitted.code, 202)
  assert.equal(admitted.value.goalId, 'goal-api')
  const immediate = await call(`operations/${admitted.value.operationId}`)
  assert.equal(immediate.code, 200); assert.equal(immediate.value.operation.tasks.length, 2)
  while (manager.current(e.id).length) await new Promise(resolve => setImmediate(resolve))
  const operation = (await call(`operations/${admitted.value.operationId}`)).value.operation
  assert.equal(operation.tasks.length, 2); assert.equal(operation.status, 'completed')
  const task = operation.tasks[0]
  assert.equal((await call(`tasks/${task.id}`)).value.task.operationId, admitted.value.operationId)
  assert.ok((await call(`tasks/${task.id}/nodes/${task.nodes[0].id}/prompts`)).value.prompts.length)
  assert.equal((await call(`tasks/${operation.tasks[1].id}/nodes/${task.nodes[0].id}/prompts`)).code, 404)
  const singleQuery = query.toString() + '&target=seconds:S01'
  let filtered
  await handler({ method: 'GET', url: `/plugins/meiji/tasks?${singleQuery}`, headers: {} }, { writeHead() {}, end: text => { filtered = JSON.parse(text) } })
  assert.equal(filtered.tasks.length, 1); assert.equal(filtered.tasks[0].targets[0], 'seconds:S01')
  assert.deepEqual((await call('operations/current')).value.operations, [])
  const draft = await saveImageDraft(e.home, Buffer.from('image'), 'image/png', 'characters', '旅人', { projectId: e.id, episodeId: e.episodeId })
  await e.store.save(e.id, root => { root.episodes[0].pendingImages[draft.draftId] = { ...draft, itemId: 'C01', key: 'characters' }; return root })
  const discarded = await call('image-review', { action: 'discard-image', projectId: e.id, episodeId: e.episodeId, sessionId, draftId: draft.draftId })
  assert.equal(discarded.code, 200); assert.deepEqual((await e.read()).pendingImages, {})
  let images
  await handler({ method: 'GET', url: `/plugins/meiji/tasks?${query}&target=image:C01`, headers: {} }, { writeHead() {}, end: text => { images = JSON.parse(text) } })
  assert.equal(images.tasks.length, 1); assert.equal(images.tasks[0].status, 'completed')
})
