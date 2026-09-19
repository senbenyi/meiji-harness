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
    const empty = await request('create', { title: '空素材项目', profile: 'preview' })
    assert.equal(empty.status, 201)
    const optional = await empty.json(); assert.equal(optional.director, null); await request('delete', { id: optional.id })
    assert.equal((await request('create', { title: '测试项目', profile: 'preview', director: '不存在的导演' })).status, 400)
    let response = await request('create', { title: '测试项目', profile: 'preview', director: '张艺谋' })
    assert.equal(response.status, 201)
    const board = await response.json(), id = board.id
    assert.match(id, /^[a-f0-9]{8}$/)
    assert.deepEqual(board.materials, [])
    let summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'configuration'); assert.equal(summary.director, '张艺谋')
    const shot = { index: 99, role: 'lin', action: '人物走入画面', subtitle: '', mode: 't2va', job_id: 'a'.repeat(32), status: 'succeeded', notes: '已确认' }
    response = await request('update', { id, acts: [{ title: '第一幕', shots: [shot, { ...shot, action: 'B' }] }] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).acts[0].shots.map(value => value.index), [1, 2])
    assert.equal((await request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: '../secret' }] }] })).status, 400)
    assert.equal((await request('delete', { id: '../bad' })).status, 400)
    assert.equal((await request('get', undefined, '&id=../../bad')).status, 400)
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.shot_count, 2); assert.equal(summary.completed_count, 2)
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'configuration'); assert.equal(summary.deliverable_count, 0)
    await request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, status: 'running' }] }] })
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'configuration')
    await request('update', { id, acts: [{ title: '第一幕', shots: [shot] }], deliverables: [{ type: 'film', label: '成品', job_id: 'a'.repeat(32) }] })
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'configuration')
    await Promise.all([request('update', { id, title: '新标题', director: '王家卫' }), request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: null, status: 'pending' }] }] })])
    handler = createProjectHandler({ token: 't' })
    const restored = await (await request('get', undefined, `&id=${id}`)).json()
    assert.equal(restored.title, '新标题'); assert.equal(restored.director, '王家卫'); assert.equal(restored.acts[0].shots[0].job_id, null)
    assert.deepEqual(restored.materials, ['a'.repeat(32)])
    const directory = join(root, 'projects', id)
    const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
    assert.deepEqual(metadata, Object.fromEntries(Object.entries(restored).filter(([key]) => !['materials', 'anchors', 'acts', 'deliverables', 'production'].includes(key))))
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'materials.json'), 'utf8')), restored.materials)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'anchors.json'), 'utf8')), restored.anchors)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'storyboard.json'), 'utf8')), restored.acts)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'deliverables.json'), 'utf8')), restored.deliverables)
    assert.deepEqual((await readdir(directory)).sort(), ['anchors.json', 'deliverables.json', 'jobs', 'materials.json', 'media', 'production', 'project.json', 'storyboard.json'])
    await mkdir(join(directory, 'jobs/task'), { recursive: true }); await writeFile(join(directory, 'jobs/task/status.json'), '{}')
    await writeFile(join(directory, 'media/clip.mp4'), 'media')
    await writeFile(join(directory, 'production/receipt.json'), '{}')
    assert.equal((await request('delete', { id })).status, 200)
    assert.equal((await request('get', undefined, `&id=${id}`)).status, 404)
    assert.deepEqual(await (await request('list')).json(), [])
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('create retries a colliding ID without overwriting the existing project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-collision-')), ids = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb']
  await seedDirectors(root, ['陈凯歌'])
  const handler = createProjectHandler({ token: 't', newId: () => ids.shift() })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/create?t=t`
  try {
    for (const title of ['原分镜', '新分镜']) {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify({ title, profile: 'preview', director: '陈凯歌' }) })
      assert.equal(response.status, 201)
      assert.equal((await response.json()).id, title === '原分镜' ? 'aaaaaaaa' : 'bbbbbbbb')
    }
    const original = JSON.parse(await readFile(join(root, 'projects/aaaaaaaa/project.json'), 'utf8'))
    assert.equal(original.title, '原分镜')
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('create stores duration aspect ratio episode count and imported script', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-create-spec-'))
  await seedDirectors(root, ['王家卫'])
  const handler = createProjectHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const request = body => fetch(`http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/create?t=t`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await request({ title: '竖屏短剧', aspect_ratio: '4:3' })).status, 400)
    assert.equal((await request({ title: '竖屏短剧', duration_min: 0 })).status, 400)
    const response = await request({ title: '竖屏短剧', duration_min: 8, aspect_ratio: '9:16', episode_count: 4, director: '王家卫', reference_text: '开场。' })
    assert.equal(response.status, 201)
    const project = await response.json()
    assert.equal(project.duration_min, 8)
    assert.equal(project.aspect_ratio, '9:16')
    assert.equal(project.episode_count, 4)
    assert.equal(project.episodes.length, 4)
    assert.equal(project.director, '王家卫')
    assert.equal(project.configuration.director, '王家卫')
    assert.equal(project.configuration.reference_text, '开场。')
    const untitled = await (await request({ title: '聊天创建' })).json()
    assert.equal(untitled.aspect_ratio, '9:16')
    assert.equal(untitled.duration_min, null)
    assert.equal(untitled.episode_count, 1)
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
    const project = await (await request('create', { title: '锚点项目', profile: 'hd', director: '姜文' })).json(), id = project.id
    assert.equal(project.profile, 'hd'); assert.deepEqual(project.materials, []); assert.deepEqual(project.deliverables, [])
    let response = await request('import', { id, as: 'anchor', job_id: 'a'.repeat(32) })
    assert.equal(response.status, 200)
    const first = await response.json()
    assert.equal(first.anchors[0].source.job_id, 'a'.repeat(32))
    assert.deepEqual(first.materials, ['a'.repeat(32)])
    response = await request('import', { id, as: 'anchor', job_id: 'b'.repeat(32), role: first.anchors[0].role })
    const replaced = await response.json()
    assert.equal(replaced.anchors.length, 1); assert.equal(replaced.anchors[0].source.job_id, 'b'.repeat(32))
    assert.deepEqual(replaced.materials, ['a'.repeat(32), 'b'.repeat(32)])
    assert.equal(replaced.profile, 'hd'); assert.deepEqual(replaced.acts, [])
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
  assert.equal(summary.cover_kind,'image')
})

test('summary lists video cover, episode count and plot without episode structure', () => {
  const summary = projectSummary({
    id: 'abcdef12', title: '旧项目', profile: 'preview', episode_count: 3, brief: '备用摘要',
    production: { revision: 1, stage: 'videos', story: { text: '雨中相遇。' }, segments: [{ generations: [{ id: 'a'.repeat(32), job_id: 'a'.repeat(32), status: 'succeeded' }], selected_generation: 'a'.repeat(32) }], exports: [] },
    anchors: [], acts: [], deliverables: [],
  })
  assert.equal(summary.cover_job_id, 'a'.repeat(32))
  assert.equal(summary.cover_kind, 'video')
  assert.equal(summary.episode_count, 3)
  assert.equal(summary.plot_summary, '雨中相遇。')
})

test('list and get keep projects that have no episode structure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-list-'))
  await seedDirectors(root, ['张艺谋'])
  const handler = createProjectHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  const request = (action, body, query = '') => fetch(`${base}/${action}?t=t${query}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const created = await request('create', { title: '旧项目', profile: 'preview', director: '张艺谋', episode_count: 3, brief: '雨中相遇。' })
    assert.equal(created.status, 201)
    const project = await created.json()
    const path = join(root, 'projects', project.id, 'project.json')
    const metadata = JSON.parse(await readFile(path, 'utf8'))
    delete metadata.episodes
    await writeFile(path, JSON.stringify(metadata))
    const listed = await (await request('list')).json()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].title, '旧项目')
    assert.equal(listed[0].episode_count, 3)
    assert.equal(listed[0].plot_summary, '雨中相遇。')
    const got = await request('get', undefined, `&id=${project.id}`)
    assert.equal(got.status, 200)
    const loaded = await got.json()
    assert.equal(loaded.title, '旧项目')
    assert.equal(loaded.episodes, undefined)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
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
