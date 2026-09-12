import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createStoryboardHandler, STORYBOARD_ROUTE } from '../src/http/storyboard.js'

test('storyboards authenticate every route and persist validated atomic CRUD with normalized shot order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-storyboard-'))
  let handler = createStoryboardHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_TOOLS_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${STORYBOARD_ROUTE}`
  const request = (action, body, query = '') => fetch(`${base}/${action}?t=t${query}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    for (const action of ['list', 'get', 'create', 'update', 'delete']) assert.equal((await fetch(`${base}/${action}`)).status, 401)
    assert.deepEqual(await (await request('list')).json(), [])
    assert.equal((await request('create')).status, 405)
    assert.equal((await request('create', { title: ' ' })).status, 400)
    let response = await request('create', { title: '测试分镜' })
    assert.equal(response.status, 201)
    const board = await response.json(), id = board.id
    assert.match(id, /^[a-f0-9]{8}$/)
    const shot = { index: 99, label: '镜头 A', prompt: '人物走入画面', job_id: 'a'.repeat(32), status: 'succeeded', notes: '已确认' }
    response = await request('update', { id, shots: [shot, { ...shot, label: '镜头 B' }] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).shots.map(value => value.index), [1, 2])
    assert.equal((await request('update', { id, shots: [{ ...shot, job_id: '../secret' }] })).status, 400)
    assert.equal((await request('delete', { id: '../bad' })).status, 400)
    assert.equal((await request('get', undefined, '&id=../../bad')).status, 400)
    const summary = (await (await request('list')).json())[0]
    assert.equal(summary.shot_count, 2); assert.equal(summary.completed_count, 2)
    await Promise.all([request('update', { id, title: '新标题' }), request('update', { id, shots: [{ ...shot, job_id: null, status: 'pending' }] })])
    handler = createStoryboardHandler({ token: 't' })
    const restored = await (await request('get', undefined, `&id=${id}`)).json()
    assert.equal(restored.title, '新标题'); assert.equal(restored.shots[0].job_id, null)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'storyboards', id, 'manifest.json'), 'utf8')), restored)
    assert.deepEqual(await readdir(join(root, 'storyboards', id)), ['manifest.json'])
    assert.equal((await request('delete', { id })).status, 200)
    assert.equal((await request('get', undefined, `&id=${id}`)).status, 404)
    assert.deepEqual(await (await request('list')).json(), [])
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('create retries a colliding ID without overwriting the existing storyboard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-collision-')), ids = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb']
  const handler = createStoryboardHandler({ token: 't', newId: () => ids.shift() })
  const server = createServer((req, res) => withConfig({ ELYSIUM_TOOLS_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}${STORYBOARD_ROUTE}/create?t=t`
  try {
    for (const title of ['原分镜', '新分镜']) {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify({ title }) })
      assert.equal(response.status, 201)
      assert.equal((await response.json()).id, title === '原分镜' ? 'aaaaaaaa' : 'bbbbbbbb')
    }
    const original = JSON.parse(await readFile(join(root, 'storyboards/aaaaaaaa/manifest.json'), 'utf8'))
    assert.equal(original.title, '原分镜')
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
