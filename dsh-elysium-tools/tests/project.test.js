import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/http/project.js'

test('projects authenticate every route and persist validated atomic CRUD with normalized shot order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-'))
  let handler = createProjectHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_TOOLS_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  const request = (action, body, query = '') => fetch(`${base}/${action}?t=t${query}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    for (const action of ['list', 'get', 'create', 'update', 'delete', 'import']) assert.equal((await fetch(`${base}/${action}`)).status, 401)
    assert.deepEqual(await (await request('list')).json(), [])
    assert.equal((await request('create')).status, 405)
    assert.equal((await request('create', { title: ' ' })).status, 400)
    let response = await request('create', { title: '测试项目', profile: 'preview' })
    assert.equal(response.status, 201)
    const board = await response.json(), id = board.id
    assert.match(id, /^[a-f0-9]{8}$/)
    const shot = { index: 99, role: 'lin', action: '人物走入画面', subtitle: '', mode: 't2va', job_id: 'a'.repeat(32), status: 'succeeded', notes: '已确认' }
    response = await request('update', { id, acts: [{ title: '第一幕', shots: [shot, { ...shot, action: 'B' }] }] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).acts[0].shots.map(value => value.index), [1, 2])
    assert.equal((await request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: '../secret' }] }] })).status, 400)
    assert.equal((await request('delete', { id: '../bad' })).status, 400)
    assert.equal((await request('get', undefined, '&id=../../bad')).status, 400)
    const summary = (await (await request('list')).json())[0]
    assert.equal(summary.shot_count, 2); assert.equal(summary.completed_count, 2)
    await Promise.all([request('update', { id, title: '新标题' }), request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: null, status: 'pending' }] }] })])
    handler = createProjectHandler({ token: 't' })
    const restored = await (await request('get', undefined, `&id=${id}`)).json()
    assert.equal(restored.title, '新标题'); assert.equal(restored.acts[0].shots[0].job_id, null)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'projects', id, 'project.json'), 'utf8')), restored)
    assert.deepEqual(await readdir(join(root, 'projects', id)), ['project.json'])
    assert.equal((await request('delete', { id })).status, 200)
    assert.equal((await request('get', undefined, `&id=${id}`)).status, 404)
    assert.deepEqual(await (await request('list')).json(), [])
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('create retries a colliding ID without overwriting the existing project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-collision-')), ids = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb']
  const handler = createProjectHandler({ token: 't', newId: () => ids.shift() })
  const server = createServer((req, res) => withConfig({ ELYSIUM_TOOLS_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/create?t=t`
  try {
    for (const title of ['原分镜', '新分镜']) {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify({ title, profile: 'preview' }) })
      assert.equal(response.status, 201)
      assert.equal((await response.json()).id, title === '原分镜' ? 'aaaaaaaa' : 'bbbbbbbb')
    }
    const original = JSON.parse(await readFile(join(root, 'projects/aaaaaaaa/project.json'), 'utf8'))
    assert.equal(original.title, '原分镜')
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('project imports reference media, replaces roles, rejects invalid anchors and keeps unrelated fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-import-'))
  const handler = createProjectHandler({ token: 't', readJob: async job_id => ({ job_id, status: 'succeeded', result: { media_kind: 'image', comfyui_view_url: 'https://model.test/image.png' } }) })
  const server = createServer((req, res) => withConfig({ ELYSIUM_TOOLS_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const request = (action, body) => fetch(`http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/${action}?t=t`, { method: 'POST', body: JSON.stringify(body) })
  try {
    const project = await (await request('create', { title: '锚点项目', profile: 'hd' })).json(), id = project.id
    assert.equal(project.profile, 'hd'); assert.deepEqual(project.deliverables, [])
    let response = await request('import', { id, as: 'anchor', job_id: 'a'.repeat(32) })
    assert.equal(response.status, 200)
    const first = await response.json()
    assert.equal(first.anchors[0].source.job_id, 'a'.repeat(32))
    response = await request('import', { id, as: 'anchor', job_id: 'b'.repeat(32), role: first.anchors[0].role })
    const replaced = await response.json()
    assert.equal(replaced.anchors.length, 1); assert.equal(replaced.anchors[0].source.job_id, 'b'.repeat(32))
    assert.equal(replaced.profile, 'hd'); assert.deepEqual(replaced.acts, [])
    assert.equal((await request('update', { id, anchors: [replaced.anchors[0], replaced.anchors[0]] })).status, 400)
    assert.equal((await request('update', { id, anchors: [{ ...replaced.anchors[0], image_url: 'file:///etc/passwd' }] })).status, 400)
    assert.equal((await request('import', { id, as: 'anchor', job_id: '../bad' })).status, 400)
    const film = { type: 'film', label: '成片', job_id: 'a'.repeat(32), duration_sec: 360, frame_count: 8640, size_bytes: 31 * 1024 * 1024 }
    const subtitle = { type: 'subtitle', label: '字幕', url: 'https://files.test/subtitle.srt' }
    response = await request('update', { id, deliverables: [film, subtitle] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).deliverables, [film, subtitle])
    assert.equal((await request('update', { id, deliverables: [{ ...subtitle, url: 'file:///tmp/subtitle.srt' }] })).status, 400)
    assert.equal((await request('update', { id, deliverables: [{ ...film, size_bytes: -1 }] })).status, 400)
    const persisted = JSON.parse(await readFile(join(root, 'projects', id, 'project.json'), 'utf8'))
    assert.deepEqual(persisted.deliverables, [film, subtitle])
    assert.equal(persisted.anchors[0].source.job_id, 'b'.repeat(32))
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
