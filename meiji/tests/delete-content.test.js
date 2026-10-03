import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'

async function file(path) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'test')
  return path
}

test('episode deletion removes only selected episode data and local videos', async t => {
  const e = await setupModel(t), other = episodeFixture()
  await e.store.save(e.id, current => ({ episodes: [...current.episodes, other] }))
  const root = join(e.home, 'storages', 'meiji', 'projects', e.id)
  const clip = await file(join(root, 'films', e.episodeId, 'S01.mp4'))
  const assembly = await file(join(root, 'films', e.episodeId, 'assembly.mp4'))
  const kept = await file(join(root, 'films', other.id, 'S01.mp4'))
  const image = await file(join(root, 'images', e.episodeId, 'C01.png'))
  await runOperation(e.op('episode-delete'), { home: e.home })
  assert.deepEqual((await e.store.read(e.id)).episodes.map(item => item.id), [other.id])
  for (const path of [clip, assembly]) await assert.rejects(access(path), { code: 'ENOENT' })
  await access(kept)
  await access(image)
})

test('project deletion removes JSON and all local videos while retaining other projects and images', async t => {
  const e = await setupModel(t)
  const other = await e.store.create({ title: '保留项目', summary: '保留内容' })
  const root = join(e.home, 'storages', 'meiji', 'projects')
  const clip = await file(join(root, e.id, 'films', e.episodeId, 'S01.mp4'))
  const image = await file(join(root, e.id, 'images', e.episodeId, 'C01.png'))
  await runOperation({ action: 'project-delete', projectId: e.id }, { home: e.home })
  await assert.rejects(e.store.read(e.id), { status: 404 })
  await assert.rejects(access(clip), { code: 'ENOENT' })
  await access(image)
  assert.equal((await e.store.read(other.id)).title, '保留项目')
})

test('missing episode does not delete project data or videos', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('episode-delete', { episodeId: '../films' }), { home: e.home }), { status: 404 })
  assert.equal((await e.store.read(e.id)).episodes.length, 1)
})
