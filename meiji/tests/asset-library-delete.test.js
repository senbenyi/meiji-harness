import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { setupModel } from './fixtures/model.js'
import { assetStore } from '../server/data/asset-library-store.js'
import { createImmediateService } from '../server/flow/immediate-service.js'
import { registerPanel } from '../server/http/panel-routes.js'
import { validateOperation } from '../server/flow/operations/operation-registry.js'
import { setContent } from '../server/models/data/drama-model.js'

test('删除素材复用面板操作与权限校验，保留项目图片和原文件', async t => {
  const e = await setupModel(t), library = assetStore(e.home)
  const asset = await library.import('characters', '人物.png', Readable.from(['image bytes']))
  await e.store.save(e.id, root => { setContent(root.episodes[0].plot.characters.items[0].image, { assetId: asset.id, assetCategory: asset.category }, { passed: true, failures: [] }); return root })
  const before = await e.store.read(e.id), previous = process.env.DSH_HOME
  let handler, rejection = null
  process.env.DSH_HOME = e.home
  try {
    registerPanel({ connection: { requestRejection: () => rejection }, sessions: new Map(), logger: { warn() {} }, effect: fn => fn(), on() {}, webServer: { register: route => { handler = route.handler } } }, Promise.resolve(), createImmediateService({ home: e.home }), { list: async () => [] })
  } finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous }
  const call = async (fields = {}, headers = { 'x-meiji-request': '1' }) => {
    const req = Readable.from([JSON.stringify({ action: 'library-delete', sessionId: 'session-11111111-1111-4111-8111-111111111111', category: asset.category, assetId: asset.id, ...fields })])
    Object.assign(req, { url: '/plugins/meiji/turn', method: 'POST', headers })
    let status, body
    await handler(req, { writeHead: value => { status = value }, end: value => { body = JSON.parse(value) } })
    return { status, body }
  }
  rejection = 401; assert.equal((await call()).status, 401); rejection = null
  assert.equal((await call({}, {})).status, 403)
  assert.equal((await call({ sessionId: '' })).status, 409)
  assert.equal((await call({ category: '../outside' })).status, 400)
  assert.equal((await call({ assetId: '../outside' })).status, 400)
  assert.equal((await call({ assetId: '00000000-0000-4000-8000-000000000000' })).status, 404)
  assert.equal((await library.list(asset.category)).length, 1)
  assert.throws(() => validateOperation({ action: 'library-delete', origin: 'session' }), { status: 403 })
  const result = await call()
  assert.equal(result.status, 200); assert.equal(result.body.completed, true); assert.ok(result.body.editId)
  assert.deepEqual(await library.list(asset.category), [])
  assert.deepEqual(await e.store.read(e.id), before)
  assert.equal(await readFile((await library.file(asset.category, asset.id)).path, 'utf8'), 'image bytes')
  assert.equal((await call()).status, 200)
})
