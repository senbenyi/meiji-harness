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
import { createProjectStore } from '../src/server/projects/service.js'
import { job, seedProject, series } from './fixtures/drama.mjs'

const cover = 'f'.repeat(32)
const imageOptions = { readJob: async job_id => ({ job_id, status: 'succeeded' }), summarizeJob: async () => ({ has_image: true }) }
const skillId = name => `director-${Buffer.from(name).toString('hex').slice(0, 16)}`
const seedDirectors = (root, names) => withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
  const store = createDirectorStore()
  for (const displayName of names) {
    const name = skillId(displayName)
    await store.save({ name, file: 'SKILL.md', content: `---\nname: ${name}\ndescription: 测试风格\nmetadata:\n  kind: director\n  display_name: ${JSON.stringify(displayName)}\n  order: 0\n---\n\n# 风格\n` })
  }
})
async function serve(t, root, options) {
  const handler = createProjectHandler({ token: 't', ...options })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}${PROJECT_ROUTE}`
  return (action, body, query = '', token = 't') => fetch(`${base}/${action}?t=${token}${query}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
const auto = { enabled: false, until_episode: null, anchors_confirmed: false, cascade_confirmed: false, paused: null, attempts: {} }

test('project completes only after every planned episode has a film and is active while producing', () => {
  const film = number => ({ number, acts: [], deliverables: [{ type: 'film', label: `第 ${number} 集`, job_id: job('a') }], film_task: null })
  const base = { id: '1234abcd', title: '双集短剧', anchors: [], auto, planning_episode_count: 2,
    episodes: [film(1), { number: 2, acts: [{ title: '第 2 集', shots: [{ status: 'pending', job_id: job('b') }] }], deliverables: [], film_task: null }] }
  assert.equal(projectSummary(base).status, 'active')
  const waiting = { ...base, episodes: [film(1), { ...base.episodes[1], acts: [] }] }
  assert.equal(projectSummary(waiting).status, 'todo')
  assert.equal(projectSummary({ ...waiting, auto: { ...auto, enabled: true } }).status, 'active')
  assert.equal(projectSummary({ ...waiting, auto: { ...auto, enabled: true, paused: { reason: '失败' } } }).status, 'todo')
  const finished = { ...waiting, episodes: [film(1), film(2)] }
  assert.deepEqual([projectSummary(finished).status, projectSummary(finished).film_count, projectSummary(finished).episode_count], ['completed', 2, 2])
})

test('projects authenticate routes, create without cover and persist only episode-based files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-project-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await seedDirectors(root, ['张艺谋', '王家卫'])
  const request = await serve(t, root, imageOptions)
  for (const action of ['list', 'get', 'create', 'update', 'delete', 'reshoot', 'auto-start']) assert.equal((await request(action, undefined, '', '')).status, 401)
  for (const action of ['episode-save', 'update-shot', 'update-anchor', 'produce', 'compose']) assert.equal((await request(action, {})).status, 404)
  assert.deepEqual(await (await request('list')).json(), [])
  assert.equal((await request('create')).status, 405)
  assert.equal((await request('create', { title: ' ' })).status, 400)
  assert.equal((await request('create', { title: '测试项目', director: '不存在的导演' })).status, 400)
  let response = await request('create', { title: '测试项目', director: skillId('张艺谋'), genre: '悬疑', synopsis: '一封信' })
  assert.equal(response.status, 201)
  const created = await response.json(), id = created.id
  assert.match(id, /^\d{17}$/)
  assert.deepEqual([created.materials, created.anchors, created.episodes, created.auto], [[], [], [], auto])
  assert.equal(created.cover_job_id, undefined)
  let summary = (await (await request('list')).json())[0]
  assert.deepEqual([summary.status, summary.director, summary.cover_job_id, summary.episode_count], ['todo', skillId('张艺谋'), null, 0])
  assert.equal((await request('update', { id, acts: [] })).status, 200)
  assert.equal((await request('import', { id, as: 'anchor', role: 'lin', job_id: job('a') })).status, 400)
  response = await request('update', { id, title: '新标题', director: skillId('王家卫'), cover_job_id: cover })
  const updated = await response.json()
  assert.deepEqual([updated.title, updated.director, updated.cover_job_id, updated.materials], ['新标题', skillId('王家卫'), cover, [cover]])
  const directory = join(root, 'projects', id)
  assert.deepEqual((await readdir(directory)).sort(), ['anchors.json', 'materials.json', 'media', 'project.json'])
  const metadata = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'))
  assert.deepEqual(Object.keys(metadata).sort(), ['cover_job_id', 'created_at', 'director', 'genre', 'id', 'synopsis', 'title', 'updated_at'])
  assert.equal((await request('delete', { id: '../bad' })).status, 400)
  assert.equal((await request('get', undefined, '&id=../../bad')).status, 400)
  assert.equal((await request('delete', { id })).status, 200)
  assert.equal((await request('get', undefined, `&id=${id}`)).status, 404)
  assert.deepEqual(await (await request('list')).json(), [])
})

test('create retries a colliding ID without overwriting the existing project', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-collision-')), ids = ['20260910143023456', '20260910143023456', '20260910143023457']
  t.after(() => rm(root, { recursive: true, force: true }))
  await seedDirectors(root, ['陈凯歌'])
  const request = await serve(t, root, { ...imageOptions, newId: () => ids.shift() })
  for (const title of ['原分镜', '新分镜']) {
    const response = await request('create', { title, director: skillId('陈凯歌') })
    assert.equal(response.status, 201)
    assert.equal((await response.json()).id, title === '原分镜' ? '20260910143023456' : '20260910143023457')
  }
  assert.equal(JSON.parse(await readFile(join(root, 'projects/20260910143023456/project.json'), 'utf8')).title, '原分镜')
})

// 封面校验、持久化和摘要读取不依赖锚点顺序或远程模型服务。
test('cover is optional, rejects non-images and falls back to the first character reference', async t => {
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
    const create = cover_job_id => store.change('create', { title: '封面项目', director: '张艺谋', cover_job_id })
    await assert.rejects(create('../invalid'), /封面素材 ID 无效/)
    await assert.rejects(create(video), /封面只能使用可用的图片素材/)
    await assert.rejects(create(missing), /封面只能使用可用的图片素材/)
    const plain = await store.change('create', { title: '无封面', director: '张艺谋' })
    await seedProject(root, plain.id)
    assert.equal((await store.list()).find(item => item.id === plain.id).cover_job_id, job('c'))
    const project = await create(image)
    assert.deepEqual(project.materials, [image])
    await assert.rejects(store.change('update', { id: project.id, cover_job_id: missing }), /封面只能使用可用的图片素材/)
    await store.change('update', { id: project.id, cover_job_id: replacement })
    store = createProjectStore({ readJob })
    const restored = await store.read(project.id)
    assert.equal(restored.cover_job_id, replacement)
    assert.ok(restored.materials.includes(replacement))
  })
})

test('anchor images are replaced only for character anchors and clear review state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await seedDirectors(root, ['姜文'])
  const request = await serve(t, root, imageOptions)
  const project = await (await request('create', { title: '锚点项目', director: skillId('姜文') })).json(), id = project.id
  await seedProject(root, id)
  const anchors = JSON.parse(await readFile(join(root, 'projects', id, 'anchors.json'), 'utf8'))
  anchors[0].image_needs_review = true
  await writeFile(join(root, 'projects', id, 'anchors.json'), JSON.stringify(anchors))
  assert.equal((await request('import', { id, as: 'anchor', role: 'scene-room', job_id: job('a') })).status, 400)
  assert.equal((await request('import', { id, as: 'anchor', role: 'nobody', job_id: job('a') })).status, 400)
  assert.equal((await request('import', { id, as: 'anchor', role: 'lin', job_id: '../bad' })).status, 400)
  const replaced = await (await request('import', { id, as: 'anchor', role: 'lin', job_id: job('a') })).json()
  assert.deepEqual(replaced.anchors[0].source, { type: 'material', job_id: job('a') })
  assert.equal(replaced.anchors[0].image_needs_review, false)
  assert.ok(replaced.materials.includes(job('a')))
})

test('shot settlement ignores stale video and keyframe jobs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-shot-settlement-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(imageOptions)
    const { id } = await store.change('create', { title: '重拍项目', director: '导演' })
    await seedProject(root, id, { shotExtra: () => ({ job_id: job('b'), keyframe_job_id: job('d'), status: 'pending' }) })
    const before = await store.readEpisode(id, 1)
    assert.equal(projectSummary(before).status, 'active')
    assert.deepEqual(await store.changeShot(id, { id: 's1', episode: 1, expect_job_id: job('a'), status: 'succeeded' }), before)
    assert.deepEqual(await store.changeShot(id, { id: 's1', episode: 1, expect_keyframe_job_id: job('a'), status: 'failed' }), before)
    assert.deepEqual(await store.changeShot(id, { id: 'gone', episode: 1, expect_job_id: job('b'), status: 'failed' }), before)
    await assert.rejects(store.changeShot(id, { id: 'gone', episode: 1, status: 'failed' }), /镜头不存在/)
    const settled = await store.changeShot(id, { id: 's1', episode: 1, expect_job_id: job('b'), status: 'succeeded' })
    assert.equal(settled.acts[0].shots[0].status, 'succeeded')
    assert.deepEqual(settled.materials, [job('c'), job('b'), job('d')])
    await assert.rejects(store.changeShot(id, { id: 's1', episode: 1, status: 'done' }), /镜字段无效/)
  })
})

test('project planning routes append validated drafts, sync anchors, draw characters and preserve data after model failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-planning-routes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await seedDirectors(root, ['测试导演'])
  await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const { createSkillsStore } = await import('../src/database/managers/skills.js')
    await createSkillsStore().seed('drama-planning', new URL('../../harness/.dsh/storages/elysium/pools/skills/drama-planning/', import.meta.url).pathname)
  })
  let calls = 0, fail = false
  const submissions = []
  const complete = async request => {
    calls++
    assert.equal(request.name, 'drama_series')
    assert.ok(request.system.includes('image_prompt'))
    if (fail) throw Object.assign(new Error('模型不可用'), { status: 503 })
    return series(2)
  }
  const submitTasks = async request => { submissions.push(request); return { tasks: [{ task_id: job('9') }] } }
  const request = await serve(t, root, { ...imageOptions, complete, submitTasks })
  const project = await (await request('create', { title: '东京故事', director: skillId('测试导演') })).json()
  const input = { id: project.id, step: 'series' }
  assert.equal((await request('plan-generate', input, '', '')).status, 401)
  assert.equal((await request('plan-edit', { ...input, value: { ...series(2), episode_count: 101 } })).status, 400)
  const withoutPrompt = series(2)
  delete withoutPrompt.characters[0].image_prompt
  assert.equal((await request('plan-edit', { ...input, value: withoutPrompt })).status, 400)
  let response = await request('plan-generate', input)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).series.versions.length, 1)
  assert.equal((await request('plan-finalize', { ...input, version: 1 })).status, 200)
  const anchors = JSON.parse(await readFile(join(root, 'projects', project.id, 'anchors.json'), 'utf8'))
  assert.deepEqual(anchors.map(item => [item.role, item.kind, item.image_prompt, item.image_job_id]), [['lin', 'character', 'adult Chinese man, grey coat', job('9')], ['scene-room', 'scene', undefined, undefined]])
  assert.deepEqual(submissions.map(item => item.tasks[0].plan.params), [{ prompt: 'adult Chinese man, grey coat', seed: submissions[0].tasks[0].plan.params.seed, character: { view: 'front' } }])
  fail = true
  response = await request('plan-generate', input)
  assert.equal(response.status, 503)
  assert.equal(JSON.parse(await readFile(join(root, 'projects', project.id, 'planning.json'), 'utf8')).series.versions.length, 1)
  assert.equal(calls, 2)
})
