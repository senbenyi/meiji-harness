import { outlineFixture } from './fixtures/story-package.js'
import { blankEpisode } from '../shared/episode-rules.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { contentNode, plotPatch } from '../shared/drama-model.js'
import { feedbackOf } from '../shared/review-feedback.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectStore, validateProject } from '../server/data/project-store.js'

async function fixture(run) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-project-'))
  try { await run(projectStore(home), home) } finally { await rm(home, { recursive: true }) }
}

test('create writes a unique UUID json file that a new store instance can read', () => fixture(async (store, home) => {
  assert.deepEqual(await store.list(), [])
  const input = { title: ' 同名短剧 ', durationSeconds: 60, summary: '一个故事' }
  const [a, b] = await Promise.all([store.create(input), store.create(input)])
  assert.notEqual(a.id, b.id)
  assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(a.title, '同名短剧')
  assert.equal(a.lifecycle, 'in-progress')
  assert.equal(a.stage, 'summary')
  assert.equal(a.workflow, 'h3')
  assert.equal(a.schemaVersion, 3)
  assert.equal(a.summary.content, input.summary)
  const file = join(home, 'storages', 'meiji', 'projects', a.id + '.json')
  const { layout, ...saved } = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(layout, 2)
  assert.equal(saved.id, a.id)
  assert.deepEqual(saved, a)
  assert.deepEqual(await projectStore(home).read(a.id), a)
  const listed = await projectStore(home).list()
  assert.equal(listed.length, 2)
  assert.deepEqual(listed.find(item => item.id === a.id), a)
}))

test('writeStep stores the outline and resets later stages', () => fixture(async store => {
  const created = await store.create({ title: '天下无贼', durationSeconds: 45, summary: '摘要' })
  const ep = blankEpisode({ summary: '摘要', durationSeconds: 45 })
  await store.save(created.id, { episodes: [ep] })
  const scoped = scopeProjects(store, ep.id)
  const saved = await scoped.writeStep(created.id, 'outline', plotPatch(ep, { outline: contentNode(ep.plot.outline, outlineFixture('大纲正文')) }))
  assert.deepEqual(saved.plot.outline.content, outlineFixture('大纲正文'))
  assert.equal(saved.shots.items.length, 0)
  assert.deepEqual(await scoped.read(created.id), saved)
}))

test('list ignores junk files and read rejects unknown ids', () => fixture(async (store, home) => {
  const created = await store.create({ title: '标题', durationSeconds: 12, summary: '摘要' })
  const root = join(home, 'storages', 'meiji', 'projects')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'not-a-uuid.json'), '{"id":"nope"}\n')
  await writeFile(join(root, created.id + '.json.tmp'), '{"id":"tmp"}\n')
  await writeFile(join(root, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'), JSON.stringify({ ...created, id: created.id }))
  assert.deepEqual(await store.list(), [created])
  await assert.rejects(store.read('not-a-uuid'), { status: 400 })
  await assert.rejects(store.read('00000000-0000-4000-8000-000000000000'), { status: 404 })
}))

test('reject incomplete or invalid project inputs', () => {
  const input = { title: '标题', summary: '摘要', durationSeconds: 60 }
  for (const patch of [{ title: ' ' }, { durationSeconds: 0 }, { durationSeconds: 1.5 }, { durationSeconds: '60.5' }]) {
    assert.throws(() => validateProject({ ...input, ...patch }))
  }
  assert.deepEqual(validateProject({ ...input, durationSeconds: '60' }), { title: '标题', durationSeconds: 60, summary: '摘要', script: '', style: '', aspectRatio: '1344x768' })
  assert.equal(validateProject({ ...input, style: ' 写实电影 ' }).style, '写实电影')
  assert.throws(() => validateProject({ ...input, style: '风'.repeat(121) }))
  assert.equal(validateProject({ title: '标题', summary: '摘要' }).durationSeconds, undefined)
  assert.equal(validateProject({ ...input, aspectRatio: '768x1344' }).aspectRatio, '768x1344')
  assert.equal(validateProject({ ...input, aspectRatio: '9:16' }).aspectRatio, '768x1344')
  assert.throws(() => validateProject({ ...input, aspectRatio: '3:4' }))
  assert.throws(() => validateProject({ ...input, aspectRatio: '21:9' }))
})

// 存储布局 v2：项目索引 + 每集一个文件；只重写有变化的剧集，提交后清理旧文件。
test('saving one episode rewrites only that episode file and cleans superseded files', () => fixture(async (store, home) => {
  const { readdir } = await import('node:fs/promises')
  const created = await store.create({ title: '分集', summary: '摘要' })
  const a = blankEpisode({ summary: '第一集', durationSeconds: 10 }), b = blankEpisode({ summary: '第二集', durationSeconds: 10 })
  await store.save(created.id, { episodes: [a, b] })
  const index = async () => JSON.parse(await readFile(join(home, 'storages', 'meiji', 'projects', created.id + '.json'), 'utf8'))
  const dir = join(home, 'storages', 'meiji', 'projects', created.id, 'episodes')
  const first = await index()
  assert.deepEqual(first.episodes.map(ref => ref.id), [a.id, b.id])
  assert.equal(first.episodes.some(ref => 'summary' in ref), false)
  await store.save(created.id, current => { current.episodes[1].title = '改过的第二集'; return current })
  const second = await index()
  assert.equal(second.episodes[0].file, first.episodes[0].file)
  assert.notEqual(second.episodes[1].file, first.episodes[1].file)
  assert.deepEqual((await readdir(dir)).sort(), second.episodes.map(ref => ref.file).sort())
  const read = await store.read(created.id)
  assert.equal(read.episodes[1].title, '改过的第二集')
  assert.equal(read.episodes[0].summary.content, '第一集')
}))

test('an interrupted save leaves the previous version readable and its orphan is cleaned later', () => fixture(async (store, home) => {
  const { readdir } = await import('node:fs/promises')
  const created = await store.create({ title: '中断', summary: '摘要' })
  const episode = blankEpisode({ summary: '原内容', durationSeconds: 10 })
  await store.save(created.id, { episodes: [episode] })
  const dir = join(home, 'storages', 'meiji', 'projects', created.id, 'episodes')
  // 模拟新剧集文件已写出、索引尚未替换时进程退出。
  await writeFile(join(dir, `${episode.id}.orphan00.json`), JSON.stringify({ ...episode, title: '未提交' }))
  assert.equal((await store.read(created.id)).episodes[0].summary.content, '原内容')
  await store.save(created.id, { title: '中断后继续' })
  assert.equal((await readdir(dir)).some(file => file.includes('orphan00')), false)
}))

test('an old single-file project is rejected with the migration command', () => fixture(async (store, home) => {
  const created = await store.create({ title: '旧布局', summary: '摘要' })
  const file = join(home, 'storages', 'meiji', 'projects', created.id + '.json')
  const { layout, ...old } = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...old, episodes: [] }))
  await assert.rejects(store.read(created.id), { code: 'OLD_LAYOUT', message: /migrate-layout\.js/ })
  await assert.rejects(store.list(), { code: 'OLD_LAYOUT' })
}))
