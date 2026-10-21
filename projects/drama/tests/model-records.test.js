import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { createRecordService } from '../src/records/service.js'

test('drama插件通过公开llm/stream拦截真实上下文，关闭并重开后记录可读', async t => {
  const root = await mkdtemp(join(tmpdir(), 'drama-model-records-')), effects = [], listeners = new Map()
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = root
  const ctx = {
    workspaceController: {}, sessionController: {}, connection: { requestRejection: () => null },
    settings: { mutate: async () => {}, update: async () => {} }, credentials: { set: async () => {} },
    logger: { warn: () => {} },
    provide(name, value) { this[name] = value },
    on(name, listener) { listeners.set(name, listener) },
    effect(fn) { effects.push(fn()) },
    webServer: { register: () => () => {} },
  }
  try {
    apply(ctx); await ctx.drama.ready
    const hook = listeners.get('llm/stream'); assert.equal(typeof hook, 'function')
    const request = Object.freeze({ provider: 'test-provider', model: 'test-model', sessionId: 'source-session', purpose: 'session-title', system: '标题系统提示词', messages: [{ role: 'user', content: [{ type: 'text', text: '用户原文' }] }] })
    const chunks = [{ type: 'text-delta', index: 0, text: '完整标题' }, { type: 'finish', reason: { kind: 'stop' } }]
    const received = []; for await (const chunk of hook(request, async function* () { yield* chunks })) received.push(chunk)
    assert.deepEqual(received, chunks)
    const id = ctx.drama.records.http.list()[0].id
    assert.equal(ctx.drama.records.http.read(id).params.system, request.system)
    for (const dispose of effects.splice(0).reverse()) await dispose?.()
    const reopened = createRecordService(join(root, 'storages/drama'))
    assert.equal(reopened.http.read(id).response.content[0].text, '完整标题')
    assert.equal(reopened.http.read(id).params.sessionId, 'source-session')
    await reopened.dispose()
  } finally {
    for (const dispose of effects.reverse()) await dispose?.()
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})
