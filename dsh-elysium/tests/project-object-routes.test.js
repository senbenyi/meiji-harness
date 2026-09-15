// 职责：验证对象级 HTTP 参数、认证，以及与聊天工具交叉编辑时的数据保留。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/business/projects/store.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/http/project-routes.js'
import { createProjectTools } from '../src/tools/project.js'

test('object routes authenticate and retain edits made through chat between panel saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-object-http-'))
  const store = createProjectStore(), handler = createProjectHandler({ token: 't', projectStore: store })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  const request = (route, body) => fetch(`${base}/${route}?t=t`, { method: 'POST', body: JSON.stringify(body) })
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const tools = Object.fromEntries(createProjectTools(store).map(tool => [tool.name, tool]))
      const project = await store.change('create', { title: '交叉编辑', director: '导演', profile: 'preview' }), id = project.id
      await store.change('update', { id, acts: [{ title: '幕', shots: [] }] })
      const since = await store.lastModified(id)
      const poll = suffix => fetch(`${base}/poll?t=t&id=${id}${suffix}`)
      assert.deepEqual(await (await poll(`&since=${since}`)).json(), { updated: false })
      assert.equal((await fetch(`${base}/poll?id=${id}&since=0`)).status, 401)
      assert.equal((await request('poll', { id, since })).status, 405)
      for (const query of ['', '&since=', '&since=no', '&since=-1', '&since=1.5']) assert.equal((await poll(query)).status, 400)
      assert.equal((await fetch(`${base}/poll?t=t&id=bad&since=0`)).status, 400)
      assert.equal((await fetch(`${base}/poll?t=t&id=00000000&since=0`)).status, 404)
      for (const route of ['update-anchor', 'update-shot']) {
        assert.equal((await fetch(`${base}/${route}`)).status, 401)
        assert.equal((await fetch(`${base}/${route}?t=t`)).status, 405)
        assert.equal((await request(route, { id, action: 'update' })).status, 400)
      }
      let response = await request('update-anchor', { id, action: 'add', data: { role: 'lin', label: '林' } })
      assert.equal(response.status, 200)
      await tools.project_update_shot.execute({ project_id: id, action: 'add', act_index: 0, patch: { role: 'lin', action: '走路' } })
      const before = await store.read(id), shotId = before.acts[0].shots[0].id
      response = await request('update-anchor', { id, action: 'update', data: { role: 'lin', new_role: 'xiaolin' } })
      assert.equal((await response.json()).acts[0].shots[0].role, 'xiaolin')
      await tools.project_update_shot.execute({ project_id: id, action: 'update', id: shotId, patch: { subtitle: '聊天字幕' } })
      response = await request('update-shot', { id, action: 'update', data: { id: shotId, notes: '手动备注' } })
      const result = await response.json()
      assert.equal(result.acts[0].shots[0].subtitle, '聊天字幕')
      assert.equal(result.acts[0].shots[0].notes, '手动备注')
      assert.equal(result.acts[0].shots[0].action, '走路')
      assert.deepEqual(await (await poll(`&since=${since}`)).json(), { updated: true })
      assert.deepEqual(await (await poll(`&since=${result.updated_at}`)).json(), { updated: false })
      assert.equal((await request('update-shot', { id: '../bad', action: 'add', data: { act_index: 0 } })).status, 400)
    })
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
