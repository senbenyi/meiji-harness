import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectSummary } from '../src/database/managers/projects.js'
import { withConfig } from '../src/config.js'
import { createDirectorStore } from '../src/server/directors/service.js'
import { createProjectHandler, PROJECT_ROUTE } from '../src/server/routes/projects.js'
import { createMediaHandler, MEDIA_ROUTE } from '../src/server/routes/media.js'

const cover = 'f'.repeat(32)
const coverOptions = { readJob: async job_id => ({ job_id, status: 'succeeded' }), summarizeJob: async () => ({ has_image: true }) }
const skillId = name => `director-${Buffer.from(name).toString('hex').slice(0, 16)}`
const seedDirectors = (root, names) => withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
  const store = createDirectorStore()
  for (const displayName of names) {
    const name = skillId(displayName)
    await store.save({ name, content: `---\nname: ${name}\ndescription: 测试风格\nmetadata:\n  kind: director\n  display_name: ${JSON.stringify(displayName)}\n  order: 0\n---\n\n# 风格\n` })
  }
})

test('project completes only after every planned episode has a film', () => {
  const base = { id: '1234abcd', title: '双集短剧', anchors: [], acts: [], deliverables: [], planning_episode_count: 2,
    episodes: [{ number: 1, acts: [], deliverables: [{ type: 'film', label: '第一集', job_id: 'a'.repeat(32) }] },
      { number: 2, acts: [{ title: '第二集', shots: [{ status: 'pending', job_id: 'b'.repeat(32) }] }], deliverables: [] }] }
  assert.equal(projectSummary(base).status, 'active')
  const waiting = { ...base, episodes: [{ ...base.episodes[0] }, { ...base.episodes[1], acts: [] }] }
  assert.equal(projectSummary(waiting).status, 'todo')
  const finished = { ...waiting, episodes: [waiting.episodes[0], { ...waiting.episodes[1], deliverables: [{ type: 'film', label: '第二集', job_id: 'c'.repeat(32) }] }] }
  assert.equal(projectSummary(finished).status, 'completed')
})

test('shot settlement ignores stale jobs and deleted shots without changing project metadata', async t => {
  const { createProjectStore } = await import('../src/database/managers/projects.js')
  const root = await mkdtemp(join(tmpdir(), 'elysium-shot-settlement-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(coverOptions)
    const created = await store.change('create', { title: '重拍项目', director: '导演', cover_job_id: cover })
    const id = created.id, oldJob = 'a'.repeat(32), newJob = 'b'.repeat(32)
    const shot = (job_id, status = 'pending') => ({ id: 'shot-1', role: '', action: '抬头', subtitle: '', mode: 't2va', job_id, status, notes: '' })
    await store.change('update', { id, acts: [{ title: '第一幕', shots: [shot(oldJob)] }] })
    await store.changeShot(id, 'update', { id: 'shot-1', job_id: newJob, status: 'pending' })
    const before = await store.read(id)
    assert.equal(projectSummary(before).status, 'active')
    const stale = await store.changeShot(id, 'update', { id: 'shot-1', expect_job_id: oldJob, status: 'succeeded' })
    assert.deepEqual(stale, before)
    assert.deepEqual(await store.read(id), before)
    const settled = await store.changeShot(id, 'update', { id: 'shot-1', expect_job_id: newJob, status: 'succeeded' })
    assert.equal(settled.acts[0].shots[0].job_id, newJob)
    assert.equal(settled.acts[0].shots[0].status, 'succeeded')
    await store.changeShot(id, 'delete', { id: 'shot-1' })
    const deleted = await store.read(id)
    assert.deepEqual(await store.changeShot(id, 'update', { id: 'shot-1', expect_job_id: newJob, status: 'failed' }), deleted)
    assert.deepEqual(await store.read(id), deleted)
  })
})

test('completed shots compose one ordered film and expose authenticated playback and download', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-film-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await seedDirectors(root, ['测试导演'])
  const projectHandler = createProjectHandler({ token: 't', ...coverOptions }), mediaHandler = createMediaHandler({ token: 't' })
  let remoteClip
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => {
    if (req.url === '/clip') return readFile(remoteClip).then(bytes => { res.setHeader('Content-Type', 'video/mp4'); res.end(bytes) })
    return req.url.startsWith(MEDIA_ROUTE) ? mediaHandler(req, res) : projectHandler(req, res)
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (action, body, token = 't') => fetch(`${base}${PROJECT_ROUTE}/${action}?t=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const project = await (await post('create', { title: '测试影片', director: skillId('测试导演'), cover_job_id: cover })).json()
  const mediaDirectory = join(root, 'projects', project.id, 'media')
  const clips = ['a'.repeat(32), 'b'.repeat(32)]
  const records = []
  for (const [index, id] of clips.entries()) {
    const path = `media/${id}.mp4`, file = join(mediaDirectory, `${id}.mp4`)
    if (index === 0) await writeFile(file, 'invalid video')
    else execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=0.3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
    records.push({ path, job_id: id, size_bytes: (await stat(file)).size })
    if (index === 1) remoteClip = file
    await mkdir(join(root, 'projects', 'jobs', id), { recursive: true })
    await writeFile(join(root, 'projects', 'jobs', id, 'status.json'), JSON.stringify({ job_id: id, project_id: project.id, status: 'succeeded', result: index === 0
      ? { media_kind: 'video', local_media_path: path } : { media_kind: 'video', comfyui_view_url: `${base}/clip` } }))
  }
  const manifest = join(mediaDirectory, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ project_id: project.id, files: records }))
  const shot = (id, index) => ({ id: `shot-${index}`, role: '', action: `动作 ${index}`, subtitle: '', mode: 't2va', job_id: id, status: 'succeeded', notes: '' })
  const acts = [{ title: '第一幕', shots: clips.map(shot) }]
  assert.equal((await post('update', { id: project.id, acts })).status, 200)
  assert.equal((await post('compose', { id: project.id }, '')).status, 401)
  assert.equal((await post('compose', { id: project.id, extra: true })).status, 400)
  assert.equal((await post('compose', { id: project.id })).status, 502)
  assert.deepEqual(await (await fetch(`${base}${PROJECT_ROUTE}/get?id=${project.id}&t=t`)).json().then(value => value.deliverables), [])
  const first = join(mediaDirectory, `${clips[0]}.mp4`)
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=0.3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', first])
  records[0].size_bytes = (await stat(first)).size
  await writeFile(manifest, JSON.stringify({ project_id: project.id, files: records }))
  const [response, duplicate] = await Promise.all([post('compose', { id: project.id }), post('compose', { id: project.id })])
  assert.equal(response.status, 200); assert.equal(duplicate.status, 200)
  const completed = await response.json(), filmId = completed.deliverables[0]?.job_id
  assert.equal((await duplicate.json()).deliverables[0]?.job_id, filmId)
  assert.match(filmId, /^[a-f0-9]{32}$/)
  assert.equal(completed.deliverables.length, 1)
  assert.equal((await (await post('compose', { id: project.id })).json()).deliverables.length, 1)
  const summary = (await (await fetch(`${base}${PROJECT_ROUTE}/list?t=t`)).json())[0]
  assert.equal(summary.status, 'completed')
  const film = await fetch(`${base}${MEDIA_ROUTE}/video?job=${filmId}&t=t`)
  assert.equal(film.status, 200); assert.equal(film.headers.get('content-type'), 'video/mp4')
  const bytes = Buffer.from(await film.arrayBuffer())
  assert.ok(bytes.length > 1000)
  const duration = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', 'pipe:0'], { input: bytes })).format.duration
  assert.ok(Number(duration) > 0.6 && Number(duration) < 1, `duration=${duration}`)
  const frame = seconds => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ss', String(seconds), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: bytes })
  const red = frame(0.1), blue = frame(0.6)
  assert.ok(red[0] > red[2] + 80)
  assert.ok(blue[2] > blue[0] + 80)
  const download = await fetch(`${base}${MEDIA_ROUTE}/download?job=${filmId}&t=t`, { method: 'HEAD' })
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/)
  await post('update', { id: project.id, acts: [{ title: '第一幕', shots: [shot(clips[0], 0), { ...shot(clips[1], 1), status: 'pending' }] }] })
  assert.equal((await post('compose', { id: project.id })).status, 409)
})

test('projects authenticate every route and persist validated atomic CRUD with normalized shot order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-'))
  await seedDirectors(root, ['张艺谋', '王家卫'])
  let handler = createProjectHandler({ token: 't', ...coverOptions })
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
    assert.equal((await request('create', { title: '测试项目', director: '张艺谋' })).status, 400)
    let response = await request('create', { title: '测试项目', profile: 'preview', director: skillId('张艺谋'), cover_job_id: cover })
    assert.equal(response.status, 201)
    const board = await response.json(), id = board.id
    assert.match(id, /^\d{17}$/)
    assert.deepEqual(board.materials, [cover])
    let summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'project'); assert.equal(summary.director, skillId('张艺谋'))
    const shot = { index: 99, role: 'lin', action: '人物走入画面', subtitle: '', mode: 't2va', job_id: 'a'.repeat(32), status: 'succeeded', notes: '已确认' }
    response = await request('update', { id, acts: [{ title: '第一幕', shots: [shot, { ...shot, action: 'B' }] }] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).acts[0].shots.map(value => value.index), [1, 2])
    assert.equal((await request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: '../secret' }] }] })).status, 400)
    assert.equal((await request('delete', { id: '../bad' })).status, 400)
    assert.equal((await request('get', undefined, '&id=../../bad')).status, 400)
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.shot_count, 2); assert.equal(summary.completed_count, 2)
    assert.equal(summary.status, 'todo'); assert.equal(summary.stage, 'episodes'); assert.equal(summary.deliverable_count, 0)
    await request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, status: 'running' }] }] })
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'active'); assert.equal(summary.stage, 'episodes')
    await request('update', { id, acts: [{ title: '第一幕', shots: [shot] }], deliverables: [{ type: 'film', label: '成品', job_id: 'a'.repeat(32) }] })
    summary = (await (await request('list')).json())[0]
    assert.equal(summary.status, 'completed'); assert.equal(summary.stage, 'episodes')
    await Promise.all([request('update', { id, title: '新标题', director: skillId('王家卫') }), request('update', { id, acts: [{ title: '第一幕', shots: [{ ...shot, job_id: null, status: 'pending' }] }] })])
    handler = createProjectHandler({ token: 't', ...coverOptions })
    const restored = await (await request('get', undefined, `&id=${id}`)).json()
    assert.equal(restored.title, '新标题'); assert.equal(restored.director, skillId('王家卫')); assert.equal(restored.acts[0].shots[0].job_id, null)
    assert.deepEqual(restored.materials, [cover, 'a'.repeat(32)])
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
  const handler = createProjectHandler({ token: 't', ...coverOptions, newId: () => ids.shift() })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/create?t=t`
  try {
    for (const title of ['原分镜', '新分镜']) {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify({ title, profile: 'preview', director: skillId('陈凯歌'), cover_job_id: cover }) })
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
  const handler = createProjectHandler({ token: 't', ...coverOptions, readJob: async job_id => ({ job_id, status: 'succeeded', result: { media_kind: 'image', comfyui_view_url: 'https://model.test/image.png' } }) })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const request = (action, body) => fetch(`http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}/${action}?t=t`, { method: 'POST', body: JSON.stringify(body) })
  try {
    const project = await (await request('create', { title: '锚点项目', director: skillId('姜文'), cover_job_id: cover })).json(), id = project.id
    assert.equal(project.profile, undefined); assert.deepEqual(project.materials, [cover]); assert.deepEqual(project.deliverables, [])
    let response = await request('import', { id, as: 'anchor', job_id: 'a'.repeat(32) })
    assert.equal(response.status, 200)
    const first = await response.json()
    assert.equal(first.anchors[0].source.job_id, 'a'.repeat(32))
    assert.deepEqual(first.materials, [cover, 'a'.repeat(32)])
    response = await request('import', { id, as: 'anchor', job_id: 'b'.repeat(32), role: first.anchors[0].role })
    const replaced = await response.json()
    assert.equal(replaced.anchors.length, 1); assert.equal(replaced.anchors[0].source.job_id, 'b'.repeat(32))
    assert.deepEqual(replaced.materials, [cover, 'a'.repeat(32), 'b'.repeat(32)])
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
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'materials.json'), 'utf8')), [cover, 'a'.repeat(32), 'b'.repeat(32)])
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

test('project planning routes append validated drafts and preserve data after model failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-planning-routes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await seedDirectors(root, ['测试导演'])
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const { createSkillsStore } = await import('../src/database/managers/skills.js')
    await createSkillsStore().seed('drama-planning', new URL('../skills/drama-planning/', import.meta.url).pathname)
  })
  let calls = 0, fail = false
  const generated = { logline: '一封信改变两人的关系', genre: '悬疑', episode_count: 2, episode_seconds: 120, world: '雨夜旧城',
    characters: [{ id: 'lin', name: '林', appearance: '灰外套', voice: '低沉', personality: '克制' }],
    scenes: [{ id: 'room', name: '公寓', description: '旧厨房' }],
    episodes: [1, 2].map(number => ({ number, title: `第 ${number} 集`, summary: '一封信', hook: '门外有人' })) }
  const complete = async request => {
    calls++
    assert.equal(request.name, 'drama_series')
    assert.ok(request.system.includes('短剧规划'))
    if (fail) throw Object.assign(new Error('模型不可用'), { status: 503 })
    return generated
  }
  const handler = createProjectHandler({ token: 't', ...coverOptions, complete })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  const post = (action, body, token = 't') => fetch(`${base}/${action}?t=${token}`, { method: 'POST', body: JSON.stringify(body) })
  const project = await (await post('create', { title: '东京故事', director: skillId('测试导演'), cover_job_id: cover })).json()
  const input = { id: project.id, step: 'series' }
  assert.equal((await post('plan-generate', input, '')).status, 401)
  assert.equal((await post('plan-edit', { ...input, value: { ...generated, episode_count: 101 } })).status, 400)
  let response = await post('plan-generate', input)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).series.versions.length, 1)
  assert.equal((await post('plan-finalize', { ...input, version: 1 })).status, 200)
  assert.deepEqual((await (await post('get', { id: project.id })).json()).error, 'Method not allowed')
  assert.deepEqual(JSON.parse(await readFile(join(root, 'projects', project.id, 'anchors.json'), 'utf8')).map(item => item.kind), ['character', 'scene'])
  fail = true
  response = await post('plan-generate', input)
  assert.equal(response.status, 503)
  const persisted = JSON.parse(await readFile(join(root, 'projects', project.id, 'planning.json'), 'utf8'))
  assert.equal(persisted.series.versions.length, 1)
  assert.equal(calls, 2)
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
