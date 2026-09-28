import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLayout } from '../scripts/migrate-layout.js'
import { projectStore } from '../server/data/projects.js'
import { blankEpisode } from '../server/data/episodes.js'

async function oldLayoutProject(t) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-layout-')); t.after(() => rm(home, { recursive: true, force: true }))
  const store = projectStore(home), created = await store.create({ title: '旧项目', summary: '摘要' })
  const episodes = [blankEpisode({ summary: '第一集', durationSeconds: 10 }), blankEpisode({ summary: '第二集', durationSeconds: 20 })]
  await store.save(created.id, { episodes })
  const expected = await store.read(created.id)
  // 还原成旧的单文件布局
  const file = join(home, 'storages', 'meiji', 'projects', created.id + '.json')
  const { layout, ...index } = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...index, episodes: expected.episodes }, null, 2))
  await rm(join(home, 'storages', 'meiji', 'projects', created.id, 'episodes'), { recursive: true })
  return { home, store, id: created.id, expected, file }
}

test('migration splits episodes, backs up the original and keeps content identical', async t => {
  const { home, store, id, expected, file } = await oldLayoutProject(t)
  const original = await readFile(file, 'utf8')
  await assert.rejects(store.read(id), { code: 'OLD_LAYOUT' })
  const result = await migrateLayout(home)
  assert.equal(result.migrated, 1)
  assert.equal(await readFile(join(result.backup, id + '.json'), 'utf8'), original)
  assert.deepEqual(await store.read(id), expected)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).layout, 2)
  assert.equal((await readdir(join(home, 'storages', 'meiji', 'projects', id, 'episodes'))).length, 2)
  assert.deepEqual(await migrateLayout(home), { migrated: 0 })
})

test('migration refuses projects that still need the model migration', async t => {
  const { home, file } = await oldLayoutProject(t)
  const source = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...source, schemaVersion: 1 }))
  await assert.rejects(migrateLayout(home), /migrate-model\.js/)
  await assert.rejects(readdir(join(home, 'backups')), { code: 'ENOENT' })
})
