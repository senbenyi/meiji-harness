import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectSummary } from '../src/database/managers/projects.js'
import { withConfig } from '../src/config.js'
import { createDirectorStore } from '../src/server/directors/service.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/server/routes/projects.js'

const seedDirectors = (root, names) => withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
  const store = createDirectorStore()
  for (const name of names) await store.create({ name, style: '测试风格', works: [] })
})

test('projects authenticate every route and persist validated atomic CRUD with normalized shot order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-'))
  await seedDirectors(root, ['张艺谋', '王家卫'])
  let handler = createProjectHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  const request = (action, body, query = '') => fetch(`${base}/${action}?t=t${query}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    for (const action of ['list', 'get', 'create', 'update', 'delete', 'import']) assert.equal((await fetch(`${base}/${action}`)).status, 401)
    assert.deepEqual(await (await request('list')).json(), [])
    assert.equal((await request('create')).status, 405)
    assert.equal((await request('create', { title: ' ' })).status, 400)
    assert.equal((await request('create', { title: '测试项目', profile: 'preview' })).status, 400)
    assert.equal((await request('create', { title: '测试项目', profile: 'preview', director: '不存在的导演' })).status, 400)
    let response = await request('create', { title: '测试项目', profile: 'preview', director: '张艺谋' })
    assert.equal(response.status, 201)
    const board = await response.json(), id = board.id
    assert.match(id, /^\d{17}$/)
    assert.deepEqual(board.materials, [])
    let summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'anchors'); assert.equal(summary.director, '张艺谋')
    const shot = { index: 99, role: 'lin', action: '人物走入画面', subtitle: '', mode: 't2va', job_id: 'a'.repeat(32), status: 'succeeded', notes: '已确认' }
    response = await request('update', { id, acts: [{ title: '第一幕', shots: [shot, { ...shot, action: 'B' }] }] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).acts[0].shots.map(value => value.index), [1, 2])
    assert.equal((await request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: '../secret' }] }] })).status, 400)
    assert.equal((await request('delete', { id: '../bad' })).status, 400)
    assert.equal((await request('get', undefined, '&id=../../bad')).status, 400)
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.shot_count, 2); assert.equal(summary.completed_count, 2)
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'deliverables'); assert.equal(summary.deliverable_count, 0)
    await request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, status: 'running' }] }] })
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'active'); assert.equal(summary.stage, 'acts')
    await request('update', { id, acts: [{ title: '第一幕', shots: [shot] }], deliverables: [{ type: 'film', label: '成品', job_id: 'a'.repeat(32) }] })
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'completed'); assert.equal(summary.stage, 'deliverables')
    await Promise.all([request('update', { id, title: '新标题', director: '王家卫' }), request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: null, status: 'pending' }] }] })])
    handler = createProjectHandler({ token: 't' })
    const restored = await (await request('get', undefined, `&id=${id}`)).json()
    assert.equal(restored.title, '新标题'); assert.equal(restored.director, '王家卫'); assert.equal(restored.acts[0].shots[0].job_id, null)
    assert.deepEqual(restored.materials, ['a'.repeat(32)])
    const directory = join(root, 'projects', id)
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    assert.deepEqual(metadata, Object.fromEntries(Object.entries(restored).filter(([key]) => !['materials', 'anchors', 'acts', 'deliverables'].includes(key))))
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'materials.json'), 'utf8')), restored.materials)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'anchors.json'), 'utf8')), restored.anchors)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'storyboard.json'), 'utf8')), restored.acts)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'deliverables.json'), 'utf8')), restored.deliverables)
    assert.deepEqual((await readdir(directory)).sort(), ['anchors.json', 'deliverables.json', 'materials.json', 'media', 'production', 'project.json', 'storyboard.json'])
    await writeFile(join(directory, 'media/clip.mp4'), 'media')
    await writeFile(join(directory, 'production/receipt.json'), '{}')
    assert.equal((await request('delete', { id })).status, 200)
    assert.equal((await request('get', undefined, `&id=${id}`)).status, 404)
    assert.deepEqual(await (await request('list')).json(), [])
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('reading a monolithic project safely migrates it into separate project files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-migration-')), id = '1234abcd'
  const directory = join(root, 'projects', id)
  const job = 'a'.repeat(32)
  const legacy = { id, title: '旧项目', profile: 'preview', created_at: 1, updated_at: 2,
    anchors: [{ role: 'lin', label: '林', description: '', source: { type: 'material', job_id: job }, image_url: '' }],
    acts: [{ title: '第一幕', shots: [] }], deliverables: [] }
  const migrated = { ...legacy, materials: [job] }
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'project.json'), JSON.stringify(legacy))
  const handler = createProjectHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/get?t=t&id=${id}`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), migrated)
    assert.deepEqual((await readdir(directory)).sort(), ['anchors.json', 'deliverables.json', 'materials.json', 'project.json', 'storyboard.json'])
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    assert.deepEqual(metadata, Object.fromEntries(Object.entries(legacy).filter(([key]) => !['anchors', 'acts', 'deliverables'].includes(key))))
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'materials.json'), 'utf8')), [job])
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'anchors.json'), 'utf8')), legacy.anchors)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'storyboard.json'), 'utf8')), legacy.acts)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'deliverables.json'), 'utf8')), legacy.deliverables)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('reading a four-file project creates its missing material index from existing references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-material-migration-')), id = '2345bcde', job = 'b'.repeat(32)
  const directory = join(root, 'projects', id)
  const metadata = { id, title: '四文件项目', profile: 'preview', created_at: 1, updated_at: 2 }
  const anchors = [], acts = [{ title: '第一幕', shots: [{ index: 1, role: '', action: '', subtitle: '', mode: 't2va', job_id: job, status: 'succeeded', notes: '' }] }], deliverables = []
  await mkdir(directory, { recursive: true })
  await Promise.all([['project.json', metadata], ['anchors.json', anchors], ['storyboard.json', acts], ['deliverables.json', deliverables]].map(([name, value]) => writeFile(join(directory, name), JSON.stringify(value))))
  const handler = createProjectHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/get?t=t&id=${id}`)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.match(result.acts[0].shots[0].id, /^[a-f0-9]{8}$/)
    acts[0].shots[0].id = result.acts[0].shots[0].id
    assert.deepEqual(result, { ...metadata, materials: [job], anchors, acts, deliverables })
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'materials.json'), 'utf8')), [job])
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('create retries a colliding ID without overwriting the existing project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-collision-')), ids = ['20260910143023456', '20260910143023456', '20260910143023457']
  await seedDirectors(root, ['陈凯歌'])
  const handler = createProjectHandler({ token: 't', newId: () => ids.shift() })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/create?t=t`
  try {
    for (const title of ['原分镜', '新分镜']) {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify({ title, profile: 'preview', director: '陈凯歌' }) })
      assert.equal(response.status, 201)
      assert.equal((await response.json()).id, title === '原分镜' ? '20260910143023456' : '20260910143023457')
    }
    const original = JSON.parse(await readFile(join(root, 'projects/20260910143023456/project.json'), 'utf8'))
    assert.equal(original.title, '原分镜')
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('project imports reference media, replaces roles, rejects invalid anchors and keeps unrelated fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-import-'))
  await seedDirectors(root, ['姜文'])
  const handler = createProjectHandler({ token: 't', readJob: async job_id => ({ job_id, status: 'succeeded', result: { media_kind: 'image', comfyui_view_url: 'https://model.test/image.png' } }) })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const request = (action, body) => fetch(`http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/${action}?t=t`, { method: 'POST', body: JSON.stringify(body) })
  try {
    const project = await (await request('create', { title: '锚点项目', director: '姜文' })).json(), id = project.id
    assert.equal(project.profile, undefined); assert.deepEqual(project.materials, []); assert.deepEqual(project.deliverables, [])
    let response = await request('import', { id, as: 'anchor', job_id: 'a'.repeat(32) })
    assert.equal(response.status, 200)
    const first = await response.json()
    assert.equal(first.anchors[0].source.job_id, 'a'.repeat(32))
    assert.deepEqual(first.materials, ['a'.repeat(32)])
    response = await request('import', { id, as: 'anchor', job_id: 'b'.repeat(32), role: first.anchors[0].role })
    const replaced = await response.json()
    assert.equal(replaced.anchors.length, 1); assert.equal(replaced.anchors[0].source.job_id, 'b'.repeat(32))
    assert.deepEqual(replaced.materials, ['a'.repeat(32), 'b'.repeat(32)])
    assert.equal(replaced.profile, undefined); assert.deepEqual(replaced.acts, [])
    assert.equal((await request('update', { id, anchors: [replaced.anchors[0], replaced.anchors[0]] })).status, 400)
    assert.equal((await request('update', { id, anchors: [{ ...replaced.anchors[0], image_url: 'file:///etc/passwd' }] })).status, 400)
    assert.equal((await request('import', { id, as: 'anchor', job_id: '../bad' })).status, 400)
    assert.equal((await request('update', { id, materials: ['../bad'] })).status, 400)
    const film = { type: 'film', label: '成片', job_id: 'a'.repeat(32), duration_sec: 360, frame_count: 8640, size_bytes: 31 * 1024 * 1024 }
    const subtitle = { type: 'subtitle', label: '字幕', url: 'https://files.test/subtitle.srt' }
    response = await request('update', { id, deliverables: [film, subtitle] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).deliverables, [film, subtitle])
    assert.equal((await request('update', { id, deliverables: [{ ...subtitle, url: 'file:///tmp/subtitle.srt' }] })).status, 400)
    assert.equal((await request('update', { id, deliverables: [{ ...film, size_bytes: -1 }] })).status, 400)
    const directory = join(root, 'projects', id)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'materials.json'), 'utf8')), ['a'.repeat(32), 'b'.repeat(32)])
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'deliverables.json'), 'utf8')), [film, subtitle])
    assert.equal(JSON.parse(await readFile(join(directory, 'anchors.json'), 'utf8'))[0].source.job_id, 'b'.repeat(32))
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('remote cover remains available when another anchor references a video job', () => {
  const summary = projectSummary({id:'abcdef12',title:'cover',profile:'preview',anchors:[{source:{job_id:'a'.repeat(32)},image_url:''},{image_url:'https://example.test/cover.png'}],acts:[],deliverables:[]})
  assert.equal(summary.cover_url,'https://example.test/cover.png')
  assert.equal(summary.cover_job_id,null)
})

test('project produce route authenticates and accepts only project, shot and submission identities', async t => {
  const calls = [], project = { id: 'abcdef12', acts: [] }
  const handler = createProjectHandler({ token: 't', projectStore: { produce: async body => { calls.push(body); return { project, tasks: [] } } } })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = token => `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/produce${token ? `?t=${token}` : ''}`
  const body = { project_id: project.id, shot_ids: ['shot-a'], submission_id: 'produce-route-001' }
  assert.equal((await fetch(url(), { method: 'POST', body: JSON.stringify(body) })).status, 401)
  assert.equal((await fetch(url('t'), { method: 'POST', body: JSON.stringify({ ...body, backend: 'comfyui' }) })).status, 400)
  assert.equal((await fetch(url('t'), { method: 'POST', body: JSON.stringify(body) })).status, 202)
  assert.deepEqual(calls, [body])
})

// 封面校验、持久化和摘要读取不依赖锚点顺序或远程模型服务。
test('selected image cover persists independently and rejects video or missing image files', async t => {
  const { createProjectStore } = await import('../src/server/projects/service.js')
  const root = await mkdtemp(join(tmpdir(), 'project-cover-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const image = 'c'.repeat(32), replacement = 'd'.repeat(32), video = 'e'.repeat(32), missing = 'f'.repeat(32)
  for (const id of [image, replacement]) {
    const directory = join(root, 'uploads', id)
    await mkdir(join(directory, 'media'), { recursive: true })
    await writeFile(join(directory, 'media', 'cover.png'), 'image')
    await writeFile(join(directory, 'media', 'manifest.json'), JSON.stringify({ files: [{ path: 'media/cover.png', job_id: id, size_bytes: 5 }] }))
  }
  const readJob = async id => ({ job_id: id, backend: 'upload', status: 'succeeded', result: { media_kind: id === video ? 'video' : 'image', local_media_path: id === video ? 'media/clip.mp4' : 'media/cover.png' } })
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    let store = createProjectStore({ readJob })
    const create = cover_job_id => store.change('create', { title: '封面项目', director: '张艺谋', profile: 'preview', cover_job_id })
    await assert.rejects(create('../invalid'), /封面素材 ID 无效/)
    await assert.rejects(create(video), /封面只能使用可用的图片素材/)
    await assert.rejects(create(missing), /封面只能使用可用的图片素材/)
    const project = await create(image)
    assert.deepEqual(project.materials, [image]); assert.deepEqual(project.anchors, [])
    await store.change('update', { id: project.id, anchors: [{ role: 'lin', label: '锚点', description: '', source: null, image_url: 'https://example.test/other.png' }] })
    assert.equal((await store.list())[0].cover_job_id, image)
    assert.equal((await store.list())[0].cover_url, null)
    await assert.rejects(store.change('update', { id: project.id, cover_job_id: missing }), /封面只能使用可用的图片素材/)
    assert.equal((await store.read(project.id)).cover_job_id, image)
    await store.change('update', { id: project.id, cover_job_id: replacement })
    store = createProjectStore({ readJob })
    const restored = await store.read(project.id)
    assert.equal(restored.cover_job_id, replacement)
    assert.ok(restored.materials.includes(replacement))
    assert.equal(restored.anchors[0].image_url, 'https://example.test/other.png')
    assert.equal((await store.list())[0].cover_job_id, replacement)
  })
})
