import { feedbackOf } from '../client/feedback.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectStore, validateProject } from '../server/data/projects.js'

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
  assert.equal(a.status, 'in-progress')
  assert.equal(a.stage, 'brief')
  assert.equal(a.workflow, 'h3')
  assert.equal(feedbackOf(a, 'brief').review.status, 'pending')
  assert.equal(a.brief, null)
  const file = join(home, 'storages', 'meiji', 'projects', a.id + '.json')
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.id, a.id)
  assert.deepEqual(saved, a)
  assert.deepEqual(await projectStore(home).read(a.id), a)
  const listed = await projectStore(home).list()
  assert.equal(listed.length, 2)
  assert.deepEqual(listed.find(item => item.id === a.id), a)
}))

test('writeStep stores the outline and resets later stages', () => fixture(async store => {
  const created = await store.create({ title: '天下无贼', durationSeconds: 45, summary: '摘要' })
  const saved = await store.writeStep(created.id, 'outline', { outline: '大纲正文' })
  assert.equal(saved.stage, 'outline')
  assert.equal(saved.outline, '大纲正文')
  assert.equal(feedbackOf(saved, 'brief').review.status, 'pending')
  assert.equal(feedbackOf(saved, 'outline').review.status, 'pending')
  assert.equal(saved.characters, null)
  assert.deepEqual(saved.films, {})
  assert.deepEqual(await store.read(created.id), saved)
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
  for (const patch of [{ title: ' ' }, { summary: '' }, { durationSeconds: 0 }, { durationSeconds: 1.5 }, { durationSeconds: '60.5' }]) {
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
